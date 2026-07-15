import CoreGraphics
import Foundation

private struct ShapeSamplePoint: Decodable {
    var x: Double
    var y: Double

    var cgPoint: CGPoint {
        CGPoint(x: x, y: y)
    }
}

private struct ShapeSampleScore: Decodable {
    var kind: String
    var score: Double
}

private struct ShapeSampleRecord: Decodable {
    var id: String
    var source: String?
    var expectedKind: String?
    var selectedKind: String?
    var reason: String?
    var rawPoints: [ShapeSamplePoint]
}

private struct Options {
    var corpusPath = "docs/notes/shape-recognition-quickdraw-samples.jsonl"
    var minAccuracy = 0.70
    var maxWrong = 16
    var showMismatches = false
    var strategy = Strategy.geometric
}

private enum Strategy: String {
    case geometric
    case exemplar
}

private struct Stats {
    var total = 0
    var correct = 0
    var none = 0
    var wrong = 0
    var matrix: [String: [String: Int]] = [:]

    var accuracy: Double {
        total == 0 ? 0 : Double(correct) / Double(total)
    }
}

private struct Mismatch {
    var id: String
    var expected: String
    var selected: String
    var debug: String
}

@main
private enum ShapeRecognitionEvaluator {
    static func main() throws {
        let options = try parseOptions()
        let url = URL(fileURLWithPath: options.corpusPath)
        let text = try String(contentsOf: url, encoding: .utf8)
        let decoder = JSONDecoder()
        let recognizer = PDFShapeRecognizer()
        let records = try text
            .split(whereSeparator: \.isNewline)
            .map { try decoder.decode(ShapeSampleRecord.self, from: Data($0.utf8)) }
        let exemplars = records
            .filter { $0.expectedKind?.isEmpty == false }
            .map { Exemplar(id: $0.id, kind: $0.expectedKind ?? "unknown", points: normalizedPath($0.rawPoints.map(\.cgPoint))) }
        var stats = Stats()
        var mismatches: [Mismatch] = []

        for sample in records {
            guard let expected = sample.expectedKind, !expected.isEmpty else { continue }
            let points = sample.rawPoints.map(\.cgPoint)
            let attempt: PDFShapeRecognitionAttempt?
            let selected: String
            switch options.strategy {
            case .geometric:
                attempt = recognizer.recognizeAttempt(points: points)
                selected = attempt?.fit?.kind ?? "none"
            case .exemplar:
                attempt = nil
                selected = classifyWithExemplars(sample: sample, points: points, exemplars: exemplars)
            }

            stats.total += 1
            stats.matrix[expected, default: [:]][selected, default: 0] += 1
            if selected == expected {
                stats.correct += 1
            } else if selected == "none" {
                stats.none += 1
            } else {
                stats.wrong += 1
            }

            if selected != expected {
                mismatches.append(Mismatch(
                    id: sample.id,
                    expected: expected,
                    selected: selected,
                    debug: attempt?.debug.consoleDetails ?? "strategy=\(options.strategy.rawValue)"
                ))
            }
        }

        printSummary(stats, corpusPath: options.corpusPath, strategy: options.strategy)
        if options.showMismatches {
            printMismatches(mismatches)
        }

        guard stats.total > 0 else {
            fputs("No labeled samples found in \(options.corpusPath)\n", stderr)
            Foundation.exit(2)
        }
        if stats.accuracy < options.minAccuracy || stats.wrong > options.maxWrong {
            fputs("Shape recognition gate failed: accuracy \(format(stats.accuracy)) < \(format(options.minAccuracy)) or wrong \(stats.wrong) > \(options.maxWrong)\n", stderr)
            Foundation.exit(1)
        }
    }

    private static func parseOptions() throws -> Options {
        var options = Options()
        var args = Array(CommandLine.arguments.dropFirst())
        while !args.isEmpty {
            let arg = args.removeFirst()
            switch arg {
            case "--corpus":
                options.corpusPath = try takeValue(arg, from: &args)
            case "--min-accuracy":
                options.minAccuracy = Double(try takeValue(arg, from: &args)) ?? options.minAccuracy
            case "--max-wrong":
                options.maxWrong = Int(try takeValue(arg, from: &args)) ?? options.maxWrong
            case "--show-mismatches":
                options.showMismatches = true
            case "--strategy":
                let rawValue = try takeValue(arg, from: &args)
                guard let strategy = Strategy(rawValue: rawValue) else {
                    throw EvaluationError.invalidArgument(rawValue)
                }
                options.strategy = strategy
            case "--help", "-h":
                printHelp()
                Foundation.exit(0)
            default:
                throw EvaluationError.invalidArgument(arg)
            }
        }
        return options
    }

    private static func takeValue(_ option: String, from args: inout [String]) throws -> String {
        guard !args.isEmpty else { throw EvaluationError.missingValue(option) }
        return args.removeFirst()
    }

    private static func printSummary(_ stats: Stats, corpusPath: String, strategy: Strategy) {
        print("corpus=\(corpusPath)")
        print("strategy=\(strategy.rawValue)")
        print("total=\(stats.total) correct=\(stats.correct) none=\(stats.none) wrong=\(stats.wrong) accuracy=\(format(stats.accuracy))")
        for expected in stats.matrix.keys.sorted() {
            let row = stats.matrix[expected, default: [:]]
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }
                .joined(separator: " ")
            print("\(expected): \(row)")
        }
    }

    private static func printMismatches(_ mismatches: [Mismatch]) {
        guard !mismatches.isEmpty else { return }
        print("mismatches:")
        for mismatch in mismatches {
            print("\(mismatch.id) expected=\(mismatch.expected) selected=\(mismatch.selected) \(mismatch.debug)")
        }
    }

    private static func printHelp() {
        print("""
        Usage:
          evaluate_shape_recognition --corpus docs/notes/shape-recognition-quickdraw-samples.jsonl

        Options:
          --corpus PATH          JSONL corpus with expectedKind and rawPoints
          --min-accuracy VALUE   fail when accuracy is below VALUE (default: 0.70)
          --max-wrong VALUE      fail when wrong non-none snaps exceed VALUE (default: 16)
          --strategy VALUE       geometric or exemplar (default: geometric)
          --show-mismatches      print every mismatch with recognizer debug scores
        """)
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.4f", value)
    }
}

private struct Exemplar {
    var id: String
    var kind: String
    var points: [CGPoint]
}

private func classifyWithExemplars(sample: ShapeSampleRecord, points: [CGPoint], exemplars: [Exemplar]) -> String {
    let normalized = normalizedPath(points)
    var best: (distance: CGFloat, kind: String)?
    for exemplar in exemplars where exemplar.id != sample.id {
        let distance = pathDistance(normalized, exemplar.points)
        if best == nil || distance < best!.distance {
            best = (distance, exemplar.kind)
        }
    }
    return best?.kind ?? "none"
}

private func normalizedPath(_ points: [CGPoint]) -> [CGPoint] {
    let sampled = resample(points, count: 64)
    guard !sampled.isEmpty else { return [] }
    let centroid = sampled.reduce(CGPoint.zero) { partial, point in
        CGPoint(x: partial.x + point.x, y: partial.y + point.y)
    }
    let center = CGPoint(x: centroid.x / CGFloat(sampled.count), y: centroid.y / CGFloat(sampled.count))
    var translated = sampled.map { CGPoint(x: $0.x - center.x, y: $0.y - center.y) }
    if let first = translated.first {
        translated = rotate(translated, by: -atan2(first.y, first.x))
    }
    let scale = max(
        translated.map { abs($0.x) }.max() ?? 1,
        translated.map { abs($0.y) }.max() ?? 1,
        1
    )
    return translated.map { CGPoint(x: $0.x / scale, y: $0.y / scale) }
}

private func pathDistance(_ lhs: [CGPoint], _ rhs: [CGPoint]) -> CGFloat {
    guard lhs.count == rhs.count, !lhs.isEmpty else { return .greatestFiniteMagnitude }
    return zip(lhs, rhs).reduce(CGFloat(0)) { sum, pair in
        sum + hypot(pair.0.x - pair.1.x, pair.0.y - pair.1.y)
    } / CGFloat(lhs.count)
}

private func resample(_ points: [CGPoint], count: Int) -> [CGPoint] {
    guard points.count > 1, count > 1 else { return points }
    let totalLength = max(polylineLength(points), 1)
    let interval = totalLength / CGFloat(count - 1)
    var result = [points[0]]
    var previous = points[0]
    var distanceSinceLast: CGFloat = 0

    for current in points.dropFirst() {
        var segmentStart = previous
        var segmentLength = hypot(current.x - segmentStart.x, current.y - segmentStart.y)
        while distanceSinceLast + segmentLength >= interval, segmentLength > 0.001 {
            let remaining = interval - distanceSinceLast
            let ratio = remaining / segmentLength
            let next = CGPoint(
                x: segmentStart.x + (current.x - segmentStart.x) * ratio,
                y: segmentStart.y + (current.y - segmentStart.y) * ratio
            )
            result.append(next)
            segmentStart = next
            segmentLength = hypot(current.x - segmentStart.x, current.y - segmentStart.y)
            distanceSinceLast = 0
        }
        distanceSinceLast += segmentLength
        previous = current
    }

    while result.count < count {
        result.append(points[points.count - 1])
    }
    return Array(result.prefix(count))
}

private func polylineLength(_ points: [CGPoint]) -> CGFloat {
    guard points.count > 1 else { return 0 }
    var total = CGFloat(0)
    for index in 1..<points.count {
        let dx = points[index].x - points[index - 1].x
        let dy = points[index].y - points[index - 1].y
        total += hypot(dx, dy)
    }
    return total
}

private func rotate(_ points: [CGPoint], by angle: CGFloat) -> [CGPoint] {
    let c = cos(angle)
    let s = sin(angle)
    return points.map { point in
        CGPoint(x: point.x * c - point.y * s, y: point.x * s + point.y * c)
    }
}

private enum EvaluationError: Error, CustomStringConvertible {
    case invalidArgument(String)
    case missingValue(String)

    var description: String {
        switch self {
        case .invalidArgument(let arg):
            return "Invalid argument: \(arg)"
        case .missingValue(let option):
            return "Missing value for \(option)"
        }
    }
}
