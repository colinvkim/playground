import PlaygroundLoader from "@/components/playground-loader";
import {
  getLanguage,
  getLessonStarter,
  languageCatalog,
} from "@/lib/playground-catalog";

type PageProps = {
  searchParams?: Promise<{
    lesson?: string;
  }>;
};

export default async function PythonPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = getLanguage("python");
  const lesson = getLessonStarter(language.id, params?.lesson);

  return (
    <PlaygroundLoader
      activeLanguage={language}
      availableLanguages={languageCatalog}
      defaultCode={lesson?.starterCode ?? language.defaultCode}
      lesson={lesson}
    />
  );
}
