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
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
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

