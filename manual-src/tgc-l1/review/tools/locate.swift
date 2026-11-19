import PDFKit
import Foundation
// locate <pdf> <queries.json> -> prints JSON {id: [[page, x, y, w, h], ...]} in % of page
let a = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: a[1]))!
let q = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[2]))) as! [[String: Any]]
var out: [String: [[Double]]] = [:]
func find(_ s: String) -> [PDFSelection] { doc.findString(s, withOptions: [.caseInsensitive]) }
for item in q {
  let id = item["id"] as! String
  let strs = item["q"] as! [String]
  var rects: [[Double]] = []
  for s in strs where !s.isEmpty {
    var sels = find(s)
    if sels.isEmpty {
      let words = s.split(separator: " ")
      if words.count > 8 {
        let head = words.prefix(5).joined(separator: " "), tail = words.suffix(4).joined(separator: " ")
        sels = find(head) + find(tail)
      }
    }
    for sel in sels.prefix(6) {
      for line in sel.selectionsByLine() {
        guard let p = line.pages.first else { continue }
        let b = line.bounds(for: p), pb = p.bounds(for: .mediaBox)
        let pi = doc.index(for: p) + 1
        rects.append([Double(pi), Double((b.minX - pb.minX) / pb.width * 100), Double((pb.maxY - b.maxY) / pb.height * 100), Double(b.width / pb.width * 100), Double(b.height / pb.height * 100)])
      }
    }
  }
  out[id] = rects
}
let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
