// Private learner tees (Nathan, 20 Nov 2026). Made in Printful, synced to
// Ecwid, kept out of the shop grid by shop/index.html (any product called
// "... Seminar Tee ..." or "... Online Tee ..." is hidden) and offered only in
// BirdBox Learn. "Add to basket" in Learn goes to /shop/?tee=<id>&size=<S..2XL>,
// which puts the tee in the Ecwid basket so it can go out with anything else
// from the shop in one delivery.
//
// Key: brand-level-year, the year being the year the seminar takes place;
// online course tees are brand-online-year, the year they enrolled.
// Price: €39 shop price, learners pay €29 (25% off) for this year and later;
// past years are €31.20 (20% off, for past learners; not built yet).
// Each January: last year's tees move to €31.20 and a new year is added
// (reminder task "learner-tees-yearly-update").
window.BB_LEARNER_TEES = {
  sizes: ["S", "M", "L", "XL", "2XL"],
  was: 39,
  tees: {
    "tgc-1-2026": { id: 879045686, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432752989", front: "6432752997" },
    "tgc-1-2027": { id: 879045687, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432866751", front: "6432745491" },
    "tgc-2-2026": { id: 879083004, price: 29, off: 25, shirt: "Mauve triblend", img: "6432745495", front: "6432868253" },
    "tgc-2-2027": { id: 879045688, price: 29, off: 25, shirt: "Mauve triblend", img: "6432860767", front: "6432866759" },
    "tcc-1-2026": { id: 879045711, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432926573", front: "6432898173" },
    "tcc-1-2027": { id: 879045712, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432926579", front: "6432926587" },
    "tcc-2-2026": { id: 879045713, price: 29, off: 25, shirt: "Charcoal-Black triblend", img: "6432898177", front: "6432926593" },
    "tcc-2-2027": { id: 879084761, price: 29, off: 25, shirt: "Charcoal-Black triblend", img: "6432924825", front: "6432924833" },
    // past years for past learners, Level 1 only (Nathan, 20 Nov 2026): 20% off.
    // No 2023 TGC (CrossFit licence that year); no past Level 2 tees.
    "tgc-1-2019": { id: 879168255, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433586223", front: "6433528991" },
    "tgc-1-2020": { id: 879084831, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433586229", front: "6433528997" },
    "tgc-1-2021": { id: 879109282, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433821763", front: "6433564661" },
    "tgc-1-2022": { id: 879109283, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433821769", front: "6433586243" },
    "tgc-1-2024": { id: 879168257, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433821775", front: "6433564673" },
    "tgc-1-2025": { id: 879109284, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433828005", front: "6433564685" },
    "tcc-1-2021": { id: 879168258, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433821807", front: "6433564691" },
    "tcc-1-2022": { id: 879084833, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433821813", front: "6433821821" },
    "tcc-1-2023": { id: 879168259, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433828011", front: "6433828019" },
    "tcc-1-2024": { id: 879084834, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433564699", front: "6433821827" },
    "tcc-1-2025": { id: 879168260, price: 31.2, off: 20, shirt: "White Fleck triblend", img: "6433828027", front: "6433564707" },
    // online course tees: TGC / TCC Level 1 online, the year they enrolled
    "tgc-online-2026": { id: 879084798, price: 29, off: 25, shirt: "Red triblend", img: "6433410381", front: "6433410389" },
    "tgc-online-2027": { id: 879084799, price: 29, off: 25, shirt: "Red triblend", img: "6433410599", front: "6433411117" },
    "tcc-online-2026": { id: 879045738, price: 29, off: 25, shirt: "True Royal triblend", img: "6433410605", front: "6433411123" },
    "tcc-online-2027": { id: 879109273, price: 29, off: 25, shirt: "True Royal triblend", img: "6433410429", front: "6433410437" }
  },
  // t.img is the back (the main picture), t.front the BirdBox eagle side
  // "€29", "€31.20"
  euro: function (n) { return "€" + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))); },
  picture: function (t, side) {
    return "https://d2j6dbq0eux0bg.cloudfront.net/images/140532633/products/" + t.id + "/" + (side === "front" && t.front ? t.front : t.img) + ".jpg";
  },
  isPrivate: function (name) {
    return /\b(Seminar|Online) Tee\b/i.test(String(name || ""));
  }
};
