/** How a skill's text reaches an agent file: leading frontmatter removed. */

import { Schema } from "effect";

// e.g. "---\n" or "---\r\n" at the start of a skill markdown body
const frontmatterOpening = /^---(?:\r\n|\n)/;
// e.g. "---\nname: x\n---\n# body" → whole leading YAML frontmatter block
const frontmatterBlock = /^---(?:\r\n|\n)(?:[\s\S]*?(?:\r\n|\n))?---(?:(?:\r\n|\n)|$)/;

export const stripFrontmatter = (markdown: string): string => markdown.replace(frontmatterBlock, "");

export const withCompleteFrontmatter = <Encoded>(markdown: Schema.Schema<string, Encoded>) =>
  markdown.pipe(
    Schema.filter((text) => !frontmatterOpening.test(text) || frontmatterBlock.test(text), {
      message: () => "Leading YAML frontmatter must have exact opening and closing delimiter lines.",
    }),
  );
