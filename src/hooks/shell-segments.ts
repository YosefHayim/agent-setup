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
export const SHELL_FIELD = "\u0002";
// Marks quoted text, so an empty quoted word such as '' stays a word, then is removed.
const QUOTED_MARK = "\u0003";

const readDoubleQuotedString = (quoted: string): string =>
  quoted.replace(DOUBLE_QUOTED_PIECE, (_piece, escapedCharacter: string | undefined) => {
    const isEscapedCharacterMissing = escapedCharacter == null;
    if (isEscapedCharacterMissing) {
      return SHELL_FIELD;
    }

    const isEscapedNewlineCharacter = escapedCharacter === "\n";
    return isEscapedNewlineCharacter ? "" : escapedCharacter;
  });

const readPieceString = (piece: RegExpExecArray): string => {
  const pieceGroups: Readonly<Record<string, string | undefined>> = { ...piece.groups };
  const { singleQuoted, doubleQuoted, escaped, plainWord, segmentBreak } = pieceGroups;

  const hasSingleQuoted = singleQuoted != null;
  if (hasSingleQuoted) {
    return `${QUOTED_MARK}${singleQuoted}`;
  }

  const hasDoubleQuoted = doubleQuoted != null;
  if (hasDoubleQuoted) {
    return `${QUOTED_MARK}${readDoubleQuotedString(doubleQuoted)}`;
  }

  const hasEscaped = escaped != null;
  if (hasEscaped) {
    const isEscapedNewline = escaped === "\n";
    return isEscapedNewline ? "" : escaped;
  }

  const hasPlainWord = plainWord != null;
  if (hasPlainWord) {
    return plainWord.replace(PLAIN_EXPANSION, SHELL_FIELD);
  }

  const isSegmentBreakMissing = segmentBreak == null;
  if (isSegmentBreakMissing) {
    return WORD_BREAK;
  }

  return `${SEGMENT_BREAK}${segmentBreak}${SEGMENT_BREAK}`;
};

// Parts alternate between segment text and the break between segments, padded with "" at both ends, so the part at an
// odd index is a segment's text, with the break that opened it before it and the break that closed it after it.
const listSegmentAt = (parts: ReadonlyArray<string>, index: number): ReadonlyArray<ShellSegment> => {
  const [openedBy = "", segmentString = "", closedBy = ""] = parts.slice(index - 1, index + 2);
  const markedWords = segmentString.split(WORD_BREAK).filter((word) => word !== "");

  const words = markedWords.map((word) => word.replaceAll(QUOTED_MARK, ""));

  const isEvenOrNoWords = index % 2 === 0 || words.length === 0;
  if (isEvenOrNoWords) {
    return [];
  }

  return [{ words, openedBy, closedBy }];
};

// Splits a shell command into the words of each simple command, e.g. "kill $(pgrep -f vite)" into ["kill", "$"]
// closed by "(" and ["pgrep", "-f", "vite"] opened by "(".
export const listShellSegments = (command: string): ReadonlyArray<ShellSegment> => {
  const pieces = Array.from(command.matchAll(SHELL_PIECE), readPieceString);
  const joinedPieces = pieces.join("");
  const parts = ["", ...joinedPieces.split(SEGMENT_BREAK), ""];
  return parts.flatMap((_part, index) => listSegmentAt(parts, index));
};
