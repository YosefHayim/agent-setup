import { z } from "zod";

// e.g. "---\n" or "---\r\n" at the start of a skill markdown body
const frontmatterOpening = /^---(?:\r\n|\n)/;
// e.g. "---\nname: x\n---\n# body" → whole leading YAML frontmatter block
const frontmatterBlock = /^---(?:\r\n|\n)(?:[\s\S]*?(?:\r\n|\n))?---(?:(?:\r\n|\n)|$)/;

export const stripFrontmatter = (markdown: string): string => markdown.replace(frontmatterBlock, "");

const isFrontmatterComplete = (markdown: string): boolean => {
  const isFrontmatterMissing = !frontmatterOpening.test(markdown);
  if (isFrontmatterMissing) {
    return true;
  }

  return frontmatterBlock.test(markdown);
};

export const markdownWithCompleteFrontmatterSchema = z
  .string()
  .refine(isFrontmatterComplete, "Leading YAML frontmatter must have exact opening and closing delimiter lines.");
