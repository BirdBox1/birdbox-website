// portal/mentor/mentor-team.js
//
// Who mentors in BirdBox Mentorship (Nathan, 25 Nov 2026): the coaches who
// said yes in the staff poll (TGC mentor / TCC mentor, 22–25 Nov) plus
// Jessica, who asked to mentor. Add or remove a line to change the team;
// the sales page, the pre-registration form and the server all use this.
// photo = their picture on the public team page (/birdbox-team/).
// price = € a week (staff €70, Nathan €85: decided 25 Nov). How many mentees
// each mentor takes is NOT here: they set it in their calendar page (places).

export const DEFAULT_PRICE = 70;
export const priceOf = (m) => m.price || DEFAULT_PRICE;

export const MENTOR_TEAM = [
  { id: "ac2157f5-5b2a-4a67-a243-e044ce808ca8", name: "Nathan Bird",          photo: "nathan-bird",          founder: true, price: 85 },
  { id: "68d7ed37-16f3-4e5d-be8b-654e9621197a", name: "Michaela Dotterweich", photo: "michaela-dotterweich" },
  { id: "e0cb29c8-fe63-4028-aac7-47258536b98a", name: "Barney Linssen",       photo: "barney-linssen" },
  { id: "96082817-8341-434d-8c67-bc6c60ca68b1", name: "Mel Zinggrebe",        photo: "mel-zinggrebe" },
  { id: "08d5eb77-4c58-470e-83d2-7d2668b683ea", name: "Marcus Grimalt",       photo: "marcus-grimalt" },
  { id: "d24fa093-da6b-4b2f-a436-8cbb0755ee2c", name: "Lukasz Wysocki",       photo: "lukasz-wysocki" },
  { id: "ae0706d9-a49b-473f-899d-21a067507085", name: "Zoltan Lovas",         photo: "zoltan-lovas" },
  { id: "9551e99e-60fb-48cd-b3ba-726e1e12340a", name: "Zsolt Sóti",           photo: "zsolt-soti" },
  { id: "6dabf345-6a3f-41f6-bc94-55b3620a75cf", name: "Jessica Estrada",      photo: "jessica-estrada" },
  { id: "8f48f57d-53c3-4f1e-a04e-2d6b24ceb11e", name: "Dane Leavy",           photo: "dane-leavy" },
  { id: "587283f8-0aa7-4180-b197-225f93e831a6", name: "Luis Vela",            photo: "luis-vela" },
  { id: "78f40fef-7607-4ed4-94b9-97f54bd8e250", name: "Sam Burns",            photo: "sam-burns" },
  { id: "a2105fc7-3392-4336-b729-7edb3d1bbe09", name: "Asier Moreno Diez",    photo: "asier-moreno-diez" },
  { id: "c4457fc2-bb5e-452e-8515-f770634023b5", name: "Justin Swart",         photo: "justin-swart" },
];
