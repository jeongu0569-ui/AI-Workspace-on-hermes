import Foundation

enum WorkspaceAPIError: Error, LocalizedError {
    case invalidURL
    case badStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid workspace server URL."
        case let .badStatus(status, body):
            "Workspace server returned \(status): \(body)"
        }
    }
}

struct WorkspaceAPI {
    var baseURL: URL
    var session: URLSession = .shared

    func workspace() async throws -> WorkspaceInfo {
        try await get("/api/workspace")
    }

    func tree(root: String, path: String = "") async throws -> TreeResponse {
        var components = try components("/api/tree")
        components.queryItems = [
            URLQueryItem(name: "root", value: root),
            URLQueryItem(name: "path", value: path)
        ]
        return try await request(components)
    }

    func file(path: String) async throws -> FileResponse {
        var components = try components("/api/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return try await request(components)
    }

    func rawURL(path: String) throws -> URL {
        var components = try components("/api/raw")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        guard let url = components.url else { throw WorkspaceAPIError.invalidURL }
        return url
    }

    func downloadRawFile(path: String, name: String) async throws -> URL {
        let url = try rawURL(path: path)
        var request = URLRequest(url: url)
        request.setValue("*/*", forHTTPHeaderField: "accept")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw WorkspaceAPIError.badStatus(status, String(data: data, encoding: .utf8) ?? "")
        }
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AIWorkspaceRawPreviews", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        let fileURL = temporaryDirectory
            .appendingPathComponent(UUID().uuidString + "-" + name)
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

    func writeFile(path: String, content: String) async throws {
        var components = try components("/api/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        let body = ["content": content]
        let _: EmptyResponse = try await request(components, method: "PUT", body: body)
    }

    func search(query: String, scopePath: String) async throws -> SearchResponse {
        let body = [
            "query": query,
            "scopePath": scopePath
        ]
        return try await post("/api/search", body: body)
    }

    func hermesModelOptions() async throws -> [HermesModelOption] {
        let data = try await dataRequest(try components("/api/hermes/models"))
        let object = try JSONSerialization.jsonObject(with: data)
        return extractHermesModels(from: object)
    }

    func hermesSessions() async throws -> [HermesSessionSummary] {
        let data = try await dataRequest(try components("/api/hermes/sessions"))
        let object = try JSONSerialization.jsonObject(with: data)
        return extractHermesSessions(from: object)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(try components(path))
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await request(try components(path), method: "POST", body: body)
    }

    private func components(_ path: String) throws -> URLComponents {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw WorkspaceAPIError.invalidURL
        }
        components.path = path
        return components
    }

    private func request<T: Decodable>(_ components: URLComponents, method: String = "GET", body: (some Encodable)? = Optional<String>.none) async throws -> T {
        let data = try await dataRequest(components, method: method, body: body)
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func dataRequest(_ components: URLComponents, method: String = "GET", body: (some Encodable)? = Optional<String>.none) async throws -> Data {
        guard let url = components.url else { throw WorkspaceAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw WorkspaceAPIError.badStatus(status, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }
}

struct EmptyResponse: Codable {}

struct AnyEncodable: Encodable {
    let encodeBody: (Encoder) throws -> Void

    init(_ value: some Encodable) {
        encodeBody = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeBody(encoder)
    }
}

private func extractHermesModels(from object: Any) -> [HermesModelOption] {
    var models: [HermesModelOption] = []
    collectHermesModels(from: object, provider: nil, into: &models)
    var seen = Set<String>()
    return models.filter { seen.insert($0.id).inserted }
}

private func collectHermesModels(from object: Any, provider: String?, into models: inout [HermesModelOption]) {
    if let value = object as? String {
        models.append(HermesModelOption(label: provider.map { "\($0) / \(value)" } ?? value, provider: provider, model: value))
        return
    }
    if let array = object as? [Any] {
        for item in array {
            collectHermesModels(from: item, provider: provider, into: &models)
        }
        return
    }
    guard let dict = object as? [String: Any] else { return }
    let nextProvider = stringValue(dict["provider"])
        ?? stringValue(dict["provider_id"])
        ?? stringValue(dict["providerId"])
        ?? stringValue(dict["name"]).flatMap { dict["models"] != nil ? $0 : nil }
        ?? provider
    if let model = stringValue(dict["model"])
        ?? stringValue(dict["model_id"])
        ?? stringValue(dict["modelId"])
        ?? stringValue(dict["id"]).flatMap({ dict["models"] == nil ? $0 : nil }) {
        let label = stringValue(dict["label"])
            ?? stringValue(dict["display_name"])
            ?? stringValue(dict["displayName"])
            ?? stringValue(dict["name"]).flatMap { $0 == nextProvider ? nil : $0 }
            ?? nextProvider.map { "\($0) / \(model)" }
            ?? model
        models.append(HermesModelOption(label: label, provider: nextProvider, model: model))
    }
    for key in ["models", "options", "model_options", "modelOptions", "items", "providers"] {
        if let nested = dict[key] {
            collectHermesModels(from: nested, provider: nextProvider, into: &models)
        }
    }
}

private func extractHermesSessions(from object: Any) -> [HermesSessionSummary] {
    var sessions: [HermesSessionSummary] = []
    collectHermesSessions(from: object, into: &sessions)
    var seen = Set<String>()
    return sessions.filter { seen.insert($0.id).inserted }
}

private func collectHermesSessions(from object: Any, into sessions: inout [HermesSessionSummary]) {
    if let array = object as? [Any] {
        for item in array {
            collectHermesSessions(from: item, into: &sessions)
        }
        return
    }
    guard let dict = object as? [String: Any] else { return }
    if let id = stringValue(dict["id"])
        ?? stringValue(dict["session_id"])
        ?? stringValue(dict["sessionId"])
        ?? stringValue(dict["stored_session_id"])
        ?? stringValue(dict["storedSessionId"]) {
        let title = stringValue(dict["title"])
            ?? stringValue(dict["name"])
            ?? stringValue(dict["summary"])
            ?? id
        let updatedAt = stringValue(dict["updated_at"])
            ?? stringValue(dict["updatedAt"])
            ?? stringValue(dict["modified_at"])
            ?? stringValue(dict["modifiedAt"])
        sessions.append(HermesSessionSummary(id: id, title: title, updatedAt: updatedAt))
    }
    for key in ["sessions", "items", "data", "results"] {
        if let nested = dict[key] {
            collectHermesSessions(from: nested, into: &sessions)
        }
    }
}

private func stringValue(_ value: Any?) -> String? {
    if let value = value as? String, !value.isEmpty { return value }
    if let value = value as? CustomStringConvertible { return String(describing: value) }
    return nil
}
