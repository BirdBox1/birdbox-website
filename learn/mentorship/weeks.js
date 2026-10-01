// BirdBox mentorship — the reflection questions for each week.
// Used by the learner page (/learn/mentorship/) and the staff page (/portal/mentorship/).
//
// To add a week: copy the whole Week 1 block, change the number, title and questions.
// Question types:
//   ["key", "Question", "long"]                           a text box
//   ["key", "Question", "scale", "Low label", "High label"]   1–10 buttons
//   ["key", "Question", "choice", ["Option A", "Option B"]]  pick one
//   { section: "Heading", note: "Optional line under it" }   a section heading
// Keys must be unique inside each form and must never change once learners have answered.

export const WEEKS = {
  1: {
    title: "What makes an effective coach?",
    start: {
      title: "Baseline reflection",
      intro: "This form is for your baseline reflection, before starting the week's learning, discussions, and coaching feedback.",
      qs: [
        ["b1", "What is your current understanding of what makes an effective coach?", "long"],
        ["b2", "How effective a coach do you feel you currently are?", "scale", "Not at all", "Expert"],
        ["b3", "How are you currently applying your understanding of what makes an effective coach in your coaching (if at all)?", "long"],
        ["b4", "What do you currently struggle with or feel unsure about?", "long"],
        ["b5", "What do you want to gain from this week?", "long"],
        ["b6", "Where do you think your current approach might be limiting your athletes or your coaching?", "long"],
      ],
    },
    end: {
      title: "Post-reflection",
      intro: "This form is to be completed at the end of your first week of mentorship. You are reflecting on the topic of what makes an effective coach.",
      qs: [
        ["p1", "What are the 3 most important things you learned in this week?", "long"],
        ["p2", "Has anything changed in how you think about what makes an effective coach? If so, what?", "long"],
        ["p3", "How confident are you now at working towards being an effective coach?", "scale", "Not at all", "Expert"],
        ["p4", "How will you apply what you have considered in this week into your coaching immediately?", "long"],
        ["p5", "What specific changes will you make in the next 1–2 weeks?", "long"],
        ["p6", "What might stop you from applying this? (time, habits, environment, etc.)", "long"],
        ["p7", "How will you ensure you follow through?", "long"],
        { section: "Coaching insight", note: "This helps your mentor understand where you are at following this week." },
        ["p8", "How will this improve your athletes' experience or results?", "long"],
        ["p9", "What would you like feedback or support on?", "long"],
        ["p10", "Self-rating", "choice", ["I fully understand and can apply this", "I understand, but need practice", "I'm still unclear"]],
      ],
    },
  },
};

// Labels for answers saved before the weekly forms existed.
export const OLD_LABELS = {
  focus: "What do you want to focus on in your coaching this week?",
  success: "What will success look like by the end of the week?",
  obstacles: "What might get in the way, and how will you handle it?",
  raise: "Is there anything you want to raise with your mentor this week?",
  confidence: "How confident are you that you will achieve your focus? (1–10)",
  how: "How did your focus go this week?",
  well: "What went well, and why?",
  differently: "What would you do differently next time?",
  learned: "What did you learn from your mentor this week?",
  next: "What will you carry into next week?",
  rating: "How would you rate your week as a coach? (1–10)",
};
