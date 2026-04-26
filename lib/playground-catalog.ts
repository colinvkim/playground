export type LanguageStatus = "ready" | "planned";

export type PlaygroundLanguage = {
  id: "python" | "javascript" | "typescript" | "swift" | "cpp";
  label: string;
  status: LanguageStatus;
  learnCourseSlug: string;
  fileExtension: string;
  runtime: "pyodide" | "planned";
  defaultCode: string;
};

export type LessonStarter = {
  languageId: PlaygroundLanguage["id"];
  lessonSlug: string;
  title: string;
  learnPath: string;
  starterCode: string;
};

export const languageCatalog: PlaygroundLanguage[] = [
  {
    id: "python",
    label: "Python",
    status: "ready",
    learnCourseSlug: "python",
    fileExtension: "py",
    runtime: "pyodide",
    defaultCode: `name = "Ada"
print(f"Hello, {name}.")

for number in range(1, 4):
    print(number)
`,
  },
  {
    id: "javascript",
    label: "JavaScript",
    status: "planned",
    learnCourseSlug: "javascript",
    fileExtension: "js",
    runtime: "planned",
    defaultCode: "",
  },
  {
    id: "typescript",
    label: "TypeScript",
    status: "planned",
    learnCourseSlug: "typescript",
    fileExtension: "ts",
    runtime: "planned",
    defaultCode: "",
  },
  {
    id: "swift",
    label: "Swift",
    status: "planned",
    learnCourseSlug: "swift",
    fileExtension: "swift",
    runtime: "planned",
    defaultCode: "",
  },
  {
    id: "cpp",
    label: "C++",
    status: "planned",
    learnCourseSlug: "cpp",
    fileExtension: "cpp",
    runtime: "planned",
    defaultCode: "",
  },
];

export const lessonStarters: LessonStarter[] = [
  {
    languageId: "python",
    lessonSlug: "variables-and-assignment",
    title: "Variables and assignment",
    learnPath: "/courses/python/variables-and-assignment",
    starterCode: `name = "Ada"
language = "Python"

print(name)
print(language)
`,
  },
  {
    languageId: "python",
    lessonSlug: "for-loops-and-ranges",
    title: "For loops and ranges",
    learnPath: "/courses/python/for-loops-and-ranges",
    starterCode: `for number in range(1, 6):
    print(number)
`,
  },
  {
    languageId: "python",
    lessonSlug: "dictionaries-and-sets",
    title: "Dictionaries and sets",
    learnPath: "/courses/python/dictionaries-and-sets",
    starterCode: `person = {
    "name": "Ada",
    "language": "Python",
}

for key, value in person.items():
    print(f"{key}: {value}")
`,
  },
  {
    languageId: "python",
    lessonSlug: "working-with-json",
    title: "Working with JSON",
    learnPath: "/courses/python/working-with-json",
    starterCode: `import json

raw = '{"name": "Ada", "active": true}'
data = json.loads(raw)

print(data["name"])
print(json.dumps(data, indent=2))
`,
  },
  {
    languageId: "python",
    lessonSlug: "exceptions-and-try-except",
    title: "Exceptions and try/except",
    learnPath: "/courses/python/exceptions-and-try-except",
    starterCode: `raw_number = "42"

try:
    value = int(raw_number)
    print(value * 2)
except ValueError:
    print("That was not a number.")
`,
  },
];

export function getDefaultPlayground() {
  return {
    language: getLanguage("python"),
  };
}

export function getLanguage(id: PlaygroundLanguage["id"]) {
  const language = languageCatalog.find((item) => item.id === id);

  if (!language) {
    throw new Error(`Unknown language: ${id}`);
  }

  return language;
}

export function getLessonStarter(
  languageId: PlaygroundLanguage["id"],
  lessonSlug?: string,
) {
  if (!lessonSlug) {
    return undefined;
  }

  return lessonStarters.find(
    (starter) =>
      starter.languageId === languageId && starter.lessonSlug === lessonSlug,
  );
}
