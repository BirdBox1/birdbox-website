// Private learner tees (Nathan, 20 Nov 2026). Made in Printful, synced to
// Ecwid, kept out of the shop grid by shop/index.html (any product called
// "... Seminar Tee ..." or "... Online Tee ..." is hidden) and offered only in
// BirdBox Learn. "Add to basket" in Learn goes to /shop/?tee=<id>&size=<S..2XL>,
// which puts the tee in the Ecwid basket so it can go out with anything else
// from the shop in one delivery.
//
// Key: brand-level-year, the year being the year the seminar takes place.
// Price: €39 shop price, learners pay €29 (25% off) for this year and later;
// past years are €31.20 (20% off, for past learners; not built yet).
// Each January: last year's tees move to €31.20 and a new year is added
// (reminder task "learner-tees-yearly-update").
window.BB_LEARNER_TEES = {
  sizes: ["S", "M", "L", "XL", "2XL"],
  was: 39,
  tees: {
    "tgc-1-2026": { id: 879045686, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432752989" },
    "tgc-1-2027": { id: 879045687, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432866751" },
    "tgc-2-2026": { id: 879083004, price: 29, off: 25, shirt: "Mauve triblend", img: "6432745495" },
    "tgc-2-2027": { id: 879045688, price: 29, off: 25, shirt: "Mauve triblend", img: "6432860767" },
    "tcc-1-2026": { id: 879045711, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432926573" },
    "tcc-1-2027": { id: 879045712, price: 29, off: 25, shirt: "White Fleck triblend", img: "6432926579" },
    "tcc-2-2026": { id: 879045713, price: 29, off: 25, shirt: "Charcoal-Black triblend", img: "6432898177" },
    "tcc-2-2027": { id: 879084761, price: 29, off: 25, shirt: "Charcoal-Black triblend", img: "6432924825" }
  },
  picture: function (t) {
    return "https://d2j6dbq0eux0bg.cloudfront.net/images/140532633/products/" + t.id + "/" + t.img + ".jpg";
  },
  isPrivate: function (name) {
    return /\b(Seminar|Online) Tee\b/i.test(String(name || ""));
  }
};
