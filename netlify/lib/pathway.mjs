// netlify/lib/pathway.mjs
//
// The Staff Pathway: how coaches apply to join BirdBox staff.
//   TGC: a paid year of mentorship; the people we bring in as staff
//        come from this group.
//   TEC: free applications for the founding team of The Endurance
//        Course, before it launches. No fee, no movement videos, and no
//        BirdBox course needed.
//
// The application page reads the lists below from pathway-apply (GET),
// so a movement or language added here shows on the form straight away.

// The courses taking applications, and how each one works.
//   paid:        shows the fee and the 12-month commitment
//   needsCourse: applicants must tick one of this course's levels
//   targets:     how many new staff we want per region (admin only,
//                never sent to the public form)
export const PATHWAYS = {
  tgc: { short: "TGC", name: "The Gymnastics Course", title: "TGC Staff Pathway", paid: true, needsCourse: "tgc" },
  tec: {
    short: "TEC", name: "The Endurance Course", title: "TEC Founding Staff", paid: false, needsCourse: null,
    targets: [
      { label: "Europe", regions: ["europe", "uk"], want: "1–2" },
      { label: "United States", regions: ["us"], want: "2–3" },
      { label: "Asia", regions: ["asia"], want: "1" },
      { label: "Australia and NZ", regions: ["oceania"], want: "1–2" },
    ],
  },
};

export const MOVEMENTS = {
  tec: [],
  tgc: [
    { group: "Strict", name: "Toes-to-bar" },
    { group: "Strict", name: "Handstand push-up" },
    { group: "Strict", name: "Pull-up" },
    { group: "Strict", name: "Ring muscle-up" },
    { group: "Strict", name: "Freestanding handstand hold" },
    { group: "Strict", name: "L-sit" },
    { group: "Dynamic", name: "Ring muscle-up" },
    { group: "Dynamic", name: "Handstand push-up" },
    { group: "Dynamic", name: "Pull-up" },
    { group: "Dynamic", name: "Toes-to-bar" },
  ],
};

// Files applicants can upload instead of linking: a video for each
// movement, and their CV and coaching philosophy as documents. All go to
// the private "pathway-videos" bucket (its own limit is 300MB a file).
export const BUCKET = "pathway-videos";
export const UPLOADS = {
  video: {
    max: 300 * 1024 * 1024,
    types: { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v", "video/3gpp": "3gp" },
  },
  doc: {
    max: 10 * 1024 * 1024,
    types: {
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    },
  },
};

// BirdBox courses an applicant can tick. They tick every one they have
// done; at least one must be the course they are applying for.
export const COURSES = {
  "tgc-l1": { brand: "tgc", label: "TGC Level 1 seminar" },
  "tgc-l1-online": { brand: "tgc", label: "TGC Level 1 online" },
  "tgc-l2": { brand: "tgc", label: "TGC Level 2" },
  "tcc-l1": { brand: "tcc", label: "TCC Level 1 seminar" },
  "tcc-l1-online": { brand: "tcc", label: "TCC Level 1 online" },
  "tcc-l2": { brand: "tcc", label: "TCC Level 2" },
};

export const TRACKS = {
  seminars: "Seminars: assisting and then leading courses",
  mentorship: "Mentorship: coaching our online mentorship clients",
  programming: "Programming: writing programming with us",
};

export const REGIONS = {
  us: "United States",
  canada: "Canada",
  latam: "Latin America",
  europe: "Europe",
  uk: "United Kingdom and Ireland",
  mea: "Middle East and Africa",
  asia: "Asia",
  oceania: "Australia and New Zealand",
  other: "Somewhere else",
};

export const LANGUAGES = [
  "English", "Spanish", "Portuguese", "French", "Italian", "German", "Polish",
  "Japanese", "Mandarin", "Cantonese", "Korean", "Thai", "Vietnamese", "Indonesian", "Filipino",
];

// What the year costs. Paying in full has a discount.
export const PRICE = { total: 5000, monthly: 417, months: 12, inFull: 4500 };

// Someone who is not accepted can apply again after this long.
export const REAPPLY_MONTHS = 6;

export const STATUS = {
  new: "To review",
  reviewing: "Reviewing",
  interview: "Interview",
  accepted: "Accepted",
  declined: "Not this time",
  withdrawn: "Withdrawn",
};
export const OPEN = ["new", "reviewing", "interview"];

export function reapplyFrom(decidedAt) {
  const d = new Date(decidedAt);
  d.setMonth(d.getMonth() + REAPPLY_MONTHS);
  return d;
}
