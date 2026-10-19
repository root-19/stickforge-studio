import type { AspectId, CaptionStyle } from "./types";

/**
 * Built-in StickForge templates. Everything here is original to this app, so
 * users can use templates freely (including in monetized videos). Using a
 * template creates a project with rendered title cards (with a stick figure),
 * an example script for Voice Studio, caption styling and a voice preset.
 */

export type FigurePose = "stand" | "point" | "think" | "shrug" | "none";

export type TemplateCard = {
  title: string;
  subtitle?: string;
  figure: FigurePose;
  /** Seconds on the timeline. */
  duration: number;
  motion: "none" | "zoomIn" | "zoomOut";
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  category: "History" | "Mystery" | "Education" | "List";
  aspect: AspectId;
  /** Background gradient (top-left → bottom-right), "#RRGGBB". */
  colors: [string, string];
  /** Subtitle / highlight colour on the cards. */
  accent: string;
  voicePresetId: string;
  caption: Partial<CaptionStyle>;
  cards: TemplateCard[];
  /** Example narration — one paragraph per card works best. */
  script: string;
};

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "did-you-know",
    name: "Did You Know? — History Short",
    description: "Hook question, three quick facts and a follow call. Built for 30–60 s Shorts and Reels.",
    category: "History",
    aspect: "9:16",
    colors: ["#06261B", "#118A55"],
    accent: "#C8FF3D",
    voicePresetId: "documentary-energetic",
    caption: { font: "Arial Black", highlightColor: "#C8FF3D", keywords: ["Roanoke", "Croatoan", "vanished"], wordsPerCaption: 3 },
    cards: [
      { title: "DID YOU KNOW?", subtitle: "A history mystery in 60 seconds", figure: "think", duration: 3, motion: "zoomIn" },
      { title: "THE YEAR: 1587", subtitle: "Roanoke Island", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "THEN… THEY VANISHED", subtitle: "115 people. Gone.", figure: "shrug", duration: 4, motion: "zoomOut" },
      { title: "ONE CLUE LEFT", subtitle: "CROATOAN", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "FOLLOW FOR PART 2", subtitle: "What really happened?", figure: "stand", duration: 3, motion: "none" },
    ],
    script: `Did you know an entire English colony disappeared without a trace?

In 1587, more than one hundred settlers landed on Roanoke Island.

Three years later, they had vanished. No bodies. No signs of a fight.

The only clue? A single word carved into a wooden post: CROATOAN.

Follow for part two, where we look at what really happened.`,
  },
  {
    id: "top-3-mysteries",
    name: "Top 3 Unsolved Mysteries",
    description: "Countdown format (#3 → #1) with a question at the end to drive comments.",
    category: "List",
    aspect: "9:16",
    colors: ["#120A2A", "#5B2A9E"],
    accent: "#FFD400",
    voicePresetId: "shorts-fast",
    caption: { font: "Impact", highlightColor: "#FFD400", keywords: ["unsolved", "never"], wordsPerCaption: 3 },
    cards: [
      { title: "3 MYSTERIES", subtitle: "nobody can explain", figure: "think", duration: 3, motion: "zoomIn" },
      { title: "#3", subtitle: "The Voynich Manuscript", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "#2", subtitle: "The Mary Celeste", figure: "shrug", duration: 4, motion: "zoomIn" },
      { title: "#1", subtitle: "The Tamam Shud case", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "WHICH ONE?", subtitle: "Comment your theory", figure: "stand", duration: 3, motion: "none" },
    ],
    script: `Here are three mysteries that experts still cannot explain.

Number three: the Voynich Manuscript. A six hundred year old book written in a language nobody can read.

Number two: the Mary Celeste. A ship found drifting in 1872, with the crew gone and the cargo untouched.

Number one: the Tamam Shud case. A man found on a beach in 1948, with a scrap of paper in a hidden pocket that read: Tamam Shud.

Which one do you think will be solved first? Tell me in the comments.`,
  },
  {
    id: "myth-vs-fact",
    name: "Myth vs Fact",
    description: "Bust a popular history myth in three beats: the myth, the fact, the real story.",
    category: "Education",
    aspect: "9:16",
    colors: ["#2A0A0A", "#0E5E5A"],
    accent: "#FF6B5B",
    voicePresetId: "documentary-energetic",
    caption: { font: "Arial Black", highlightColor: "#FF6B5B", keywords: ["myth", "fact", "actually"], wordsPerCaption: 4 },
    cards: [
      { title: "MYTH", subtitle: "Vikings wore horned helmets", figure: "shrug", duration: 4, motion: "zoomIn" },
      { title: "FACT", subtitle: "No horned helmet has ever been found", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "THE REAL STORY", subtitle: "Blame an 1876 opera", figure: "think", duration: 5, motion: "zoomOut" },
    ],
    script: `Myth: Vikings wore horned helmets into battle.

Fact: archaeologists have never found a single horned Viking helmet.

So where did the idea come from? Costume designers for an opera in 1876 gave the Vikings horns, and the image stuck.`,
  },
  {
    id: "mystery-story",
    name: "Unsolved Mystery Story",
    description: "Slow, suspenseful storytelling with longer pauses. Dark blue look.",
    category: "Mystery",
    aspect: "9:16",
    colors: ["#020814", "#123B6B"],
    accent: "#7FD4FF",
    voicePresetId: "mystery-slow",
    caption: { font: "Georgia", highlightColor: "#7FD4FF", uppercase: false, keywords: ["never", "disappeared"], wordsPerCaption: 4 },
    cards: [
      { title: "SOME SECRETS…", subtitle: "stay buried", figure: "none", duration: 3, motion: "zoomIn" },
      { title: "THE NIGHT IT HAPPENED", figure: "think", duration: 5, motion: "zoomIn" },
      { title: "NO ONE SAW A THING", figure: "shrug", duration: 5, motion: "zoomOut" },
      { title: "WHAT DO YOU THINK?", figure: "stand", duration: 3, motion: "none" },
    ],
    script: `Some secrets stay buried forever.

On a cold night in 1959, nine experienced hikers set up camp in the Ural Mountains.

By morning, they had cut their tent open from the inside and walked into the snow. None of them came back.

To this day, nobody can say for sure what drove them out. What do you think happened?`,
  },
  {
    id: "documentary-explainer",
    name: "YouTube Documentary Explainer",
    description: "16:9 landscape explainer: title, three steps, summary and subscribe card. Boxed captions.",
    category: "Education",
    aspect: "16:9",
    colors: ["#0B1E16", "#1F7A4A"],
    accent: "#B8FF5C",
    voicePresetId: "steady-explainer",
    caption: { font: "Arial", background: "box", fontSize: 64, highlightColor: "#B8FF5C", wordsPerCaption: 6, uppercase: false },
    cards: [
      { title: "HOW IT WORKS", subtitle: "explained with stick figures", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "STEP 1", subtitle: "The idea", figure: "think", duration: 5, motion: "none" },
      { title: "STEP 2", subtitle: "How it spreads", figure: "point", duration: 5, motion: "none" },
      { title: "STEP 3", subtitle: "Why it matters", figure: "stand", duration: 5, motion: "none" },
      { title: "SUBSCRIBE", subtitle: "for more history explained", figure: "stand", duration: 3, motion: "zoomOut" },
    ],
    script: `Today we are going to explain how it works, step by step.

Step one: the idea. Every big change in history starts with a simple idea.

Step two: how it spreads. Ideas travel through trade, travel, and stories.

Step three: why it matters. Once enough people believe something, it can change the world.

If you enjoyed this, subscribe for more history explained.`,
  },
  {
    id: "then-and-now",
    name: "Then vs Now — Square Post",
    description: "1:1 comparison post for Facebook and Instagram feeds.",
    category: "History",
    aspect: "1:1",
    colors: ["#2B2109", "#7A5A12"],
    accent: "#FFE08A",
    voicePresetId: "documentary-energetic",
    caption: { font: "Arial Black", highlightColor: "#FFE08A", wordsPerCaption: 4 },
    cards: [
      { title: "THEN", subtitle: "1900", figure: "stand", duration: 4, motion: "zoomIn" },
      { title: "NOW", subtitle: "Today", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "WOULD YOU GO BACK?", figure: "think", duration: 3, motion: "none" },
    ],
    script: `In 1900, a trip across the Atlantic took about a week by steamship.

Today, the same trip takes about seven hours by plane.

Would you have wanted to live back then?`,
  },
  {
    id: "quick-fact-feed",
    name: "Quick History Fact — Portrait Feed",
    description: "4:5 single-fact post that fills the Facebook/Instagram feed.",
    category: "History",
    aspect: "4:5",
    colors: ["#06261B", "#2E8B57"],
    accent: "#C8FF3D",
    voicePresetId: "documentary-energetic",
    caption: { font: "Arial Black", highlightColor: "#C8FF3D", wordsPerCaption: 4 },
    cards: [
      { title: "HISTORY FACT", subtitle: "you didn't learn in school", figure: "point", duration: 4, motion: "zoomIn" },
      { title: "CLEOPATRA", subtitle: "lived closer to the Moon landing than to the pyramids", figure: "shrug", duration: 6, motion: "zoomOut" },
    ],
    script: `Here is a history fact you probably did not learn in school.

Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.`,
  },
];

export function getTemplate(id: string): ProjectTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
