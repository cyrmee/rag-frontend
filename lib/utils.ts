export { cn } from "cn"

// Document filenames are paths from the drive they were ingested from
// ("ID/Admin/Letters/Plan.docx"). Shown as the file's own name, with the
// folder as quieter context.
export function splitPath(filename: string): { name: string; folder: string } {
  const slash = filename.lastIndexOf("/");
  if (slash === -1) return { name: filename, folder: "" };
  return { name: filename.slice(slash + 1), folder: filename.slice(0, slash) };
}
