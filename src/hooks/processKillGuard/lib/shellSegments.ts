export type ShellSegment = {
  readonly words: ReadonlyArray<string>;
  readonly openedBy: string;
  readonly closedBy: string;
};

// e.g. 'single quoted', "double \"quoted\"", \; then redirects such as 2>/dev/null or &> out.log and comments such as
// "# kill the old server" that hold no command words, then plain words, the breaks ; & | ( ) ` and newlines, and blanks
const SHELL_PIECE =
  /'(?<singleQuoted>[^']*)'|"(?<doubleQuoted>(?:\\.|[^"\\])*)"|\\(?<escaped>.)|\d*(?:&>>?|[<>]&|>>?|<)[^\S\n]*[^\s'"\\;&|()`<>]*|(?<![^\s;&|()`])#[^\n]*|(?<plainWord>[^\s'"\\;&|()`<>]+)|(?<segmentBreak>[;&|()`\n])|[^\S\n]+/gsu;
// e.g. $PATTERN, ${PATTERN}, $1 or $$ in a plain word
const PLAIN_EXPANSION = /\$(?:\{[^}]*\}|[A-Za-z_]\w*|[\d@*#?$!-])/gu;
// e.g. \" or \$ or a line continuation inside double quotes, else an expansion such as "$PATTERN" or "$(cat name.txt)"
const DOUBLE_QUOTED_PIECE = /\\([\\"$`\n])|\$(?:\{[^}]*\}|\([^)]*\)|[A-Za-z_]\w*|[\d@*#?$!-])|`[^`]*`/gu;
// Pieces are rejoined around control characters that shell commands do not contain, then split back into words.
const WORD_BREAK = "\u0000";
const SEGMENT_BREAK = "\u0001";
// Stands for the unknown text a shell expansion produces when the command runs.
export const SHELL_VALUE = "\u0002";

const doubleQuotedText = (quoted: string): string =>
  quoted.replace(DOUBLE_QUOTED_PIECE, (_piece, escapedCharacter: string | undefined) => {
    if (escapedCharacter === undefined) {
      return SHELL_VALUE;
    }

    return escapedCharacter === "\n" ? "" : escapedCharacter;
  });

const pieceText = (piece: RegExpExecArray): string => {
  const pieceGroups: Readonly<Record<string, string | undefined>> = { ...piece.groups };
  const { singleQuoted, doubleQuoted, escaped, plainWord, segmentBreak } = pieceGroups;
  if (singleQuoted !== undefined) {
    return singleQuoted;
  }

  if (doubleQuoted !== undefined) {
    return doubleQuotedText(doubleQuoted);
  }

  if (escaped !== undefined) {
    return escaped === "\n" ? "" : escaped;
  }

  if (plainWord !== undefined) {
    return plainWord.replace(PLAIN_EXPANSION, SHELL_VALUE);
  }

  if (segmentBreak === undefined) {
    return WORD_BREAK;
  }

  return `${SEGMENT_BREAK}${segmentBreak}${SEGMENT_BREAK}`;
};

// Parts alternate between segment text and the break between segments, padded with "" at both ends, so the part at an
// odd index is a segment's text, with the break that opened it before it and the break that closed it after it.
const segmentAt = (parts: ReadonlyArray<string>, index: number): ReadonlyArray<ShellSegment> => {
  const [openedBy = "", segmentText = "", closedBy = ""] = parts.slice(index - 1, index + 2);
  const words = segmentText.split(WORD_BREAK).filter((word) => word !== "");
  if (index % 2 === 0 || words.length === 0) {
    return [];
  }

  return [{ words, openedBy, closedBy }];
};

// Splits a shell command into the words of each simple command, e.g. "kill $(pgrep -f vite)" into ["kill", "$"]
// closed by "(" and ["pgrep", "-f", "vite"] opened by "(".
export const shellSegments = (command: string): ReadonlyArray<ShellSegment> => {
  const pieces = Array.from(command.matchAll(SHELL_PIECE), pieceText);
  const joinedPieces = pieces.join("");
  const parts = ["", ...joinedPieces.split(SEGMENT_BREAK), ""];
  return parts.flatMap((_part, index) => segmentAt(parts, index));
};
