import SwiftUI
import PDFKit

#if os(iOS)
import PencilKit
#endif

struct PDFWorkspaceView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let rawFile: RawFilePreview
    @State private var annotations: PDFAnnotationDocument?
    @State private var statusText = ""
    @State private var saveTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Label("PDF", systemImage: "doc.richtext")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                if !statusText.isEmpty {
                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 7)
            .background(.quaternary.opacity(0.08))

            #if os(iOS)
            AnnotatedPDFKitView(
                url: rawFile.url,
                annotations: annotations,
                onPageInkChanged: updatePageInk(pageIndex:data:)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            #else
            PDFPreviewView(url: rawFile.url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            #endif
        }
        .task(id: rawFile.path) {
            await loadAnnotations()
        }
        .onDisappear {
            saveTask?.cancel()
        }
    }

    private func loadAnnotations() async {
        guard let api = store.api else { return }
        do {
            annotations = try await api.fileAnnotations(path: rawFile.path)
            statusText = annotations?.pages.isEmpty == false ? "Annotations loaded" : "Ready"
        } catch {
            annotations = PDFAnnotationDocument(
                schemaVersion: 1,
                documentPath: rawFile.path,
                updatedAt: nil,
                pages: [],
                objects: []
            )
            statusText = "Annotation sync unavailable"
        }
    }

    private func updatePageInk(pageIndex: Int, data: Data) {
        var next = annotations ?? PDFAnnotationDocument(
            schemaVersion: 1,
            documentPath: rawFile.path,
            updatedAt: nil,
            pages: [],
            objects: []
        )
        let encoded = data.base64EncodedString()
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            next.pages[index].inkDataBase64 = encoded
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: encoded, objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        statusText = "Saving..."
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            await saveAnnotations(next)
        }
    }

    private func saveAnnotations(_ document: PDFAnnotationDocument) async {
        guard let api = store.api else { return }
        do {
            let saved = try await api.saveFileAnnotations(path: rawFile.path, annotations: document)
            guard !Task.isCancelled else { return }
            annotations = saved
            statusText = "Saved"
        } catch {
            guard !Task.isCancelled else { return }
            statusText = "Save failed"
        }
    }
}

#if os(iOS)
struct AnnotatedPDFKitView: UIViewRepresentable {
    let url: URL
    var annotations: PDFAnnotationDocument?
    var onPageInkChanged: (Int, Data) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPageInkChanged: onPageInkChanged)
    }

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        view.pageOverlayViewProvider = context.coordinator
        context.coordinator.pdfView = view
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        context.coordinator.onPageInkChanged = onPageInkChanged
        context.coordinator.annotations = annotations
        if context.coordinator.currentURL != url {
            context.coordinator.currentURL = url
            context.coordinator.canvases.removeAll()
            view.document = PDFDocument(url: url)
        } else if view.document == nil {
            view.document = PDFDocument(url: url)
        }
        context.coordinator.applyAnnotationsToVisibleCanvases()
    }

    final class Coordinator: NSObject, @preconcurrency PDFPageOverlayViewProvider, PKCanvasViewDelegate {
        weak var pdfView: PDFView?
        var currentURL: URL?
        var annotations: PDFAnnotationDocument?
        var onPageInkChanged: (Int, Data) -> Void
        var canvases: [Int: PKCanvasView] = [:]
        private var applyingProgrammaticDrawing = false

        init(onPageInkChanged: @escaping (Int, Data) -> Void) {
            self.onPageInkChanged = onPageInkChanged
        }

        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            guard let document = view.document else { return nil }
            let pageIndex = document.index(for: page)
            if let existing = canvases[pageIndex] {
                return existing
            }

            let canvas = PKCanvasView()
            canvas.backgroundColor = .clear
            canvas.isOpaque = false
            canvas.drawingPolicy = .anyInput
            canvas.delegate = self
            canvas.alwaysBounceVertical = false
            canvas.alwaysBounceHorizontal = false
            canvas.minimumZoomScale = 1
            canvas.maximumZoomScale = 1
            canvases[pageIndex] = canvas
            applyAnnotation(to: canvas, pageIndex: pageIndex)
            return canvas
        }

        func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
            guard let canvas = overlayView as? PKCanvasView,
                  let pageIndex = pdfView.document?.index(for: page) else { return }
            applyAnnotation(to: canvas, pageIndex: pageIndex)
        }

        func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
            guard let canvas = overlayView as? PKCanvasView,
                  let pageIndex = pdfView.document?.index(for: page) else { return }
            onPageInkChanged(pageIndex, canvas.drawing.dataRepresentation())
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            guard !applyingProgrammaticDrawing,
                  let pageIndex = canvases.first(where: { $0.value === canvasView })?.key else { return }
            onPageInkChanged(pageIndex, canvasView.drawing.dataRepresentation())
        }

        func applyAnnotationsToVisibleCanvases() {
            for (pageIndex, canvas) in canvases {
                applyAnnotation(to: canvas, pageIndex: pageIndex)
            }
        }

        private func applyAnnotation(to canvas: PKCanvasView, pageIndex: Int) {
            guard let encoded = annotations?.pages.first(where: { $0.pageIndex == pageIndex })?.inkDataBase64,
                  let data = Data(base64Encoded: encoded),
                  let drawing = try? PKDrawing(data: data) else { return }
            if canvas.drawing.dataRepresentation() == data { return }
            applyingProgrammaticDrawing = true
            canvas.drawing = drawing
            applyingProgrammaticDrawing = false
        }
    }
}
#endif
