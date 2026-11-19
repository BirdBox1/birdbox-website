import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
  let img = NSImage(contentsOfFile: path)!
  var r = CGRect(origin: .zero, size: img.size)
  let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil)!
  let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
  try! VNImageRequestHandler(cgImage: cg).perform([req])
  print("=== \(path)")
  for o in req.results ?? [] { let b=o.boundingBox; print(String(format:"[%.3f %.3f] ", b.minX, 1-b.maxY) + (o.topCandidates(1).first?.string ?? "")) }
}
