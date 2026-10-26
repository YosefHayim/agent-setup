// e.g. 'single quoted', "double \"quoted\"", \; and plain words, then redirects such as 2>/dev/null or &> out.log that
// hold no command words, then the breaks ; & | ( ) ` and newlines, then blanks
const SHELL_PIECE =
  /'(?<singleQuoted>[^']*)'|"(?<doubleQuoted>(?:\\.|[^"\\])*)"|\\(?<escaped>.)|\d*(?:&>>?|[<>]&|>>?|<)[^\S\n]*[^\s'"\\;&|()`<>]*|(?<plainWord>[^\s'"\\;&|()`<>]+)|(?<segmentBreak>[;&|()`\n])|[^\S\n]+/gsu;
// e.g. \" or \$ inside double quotes
const DOUBLE_QUOTED_ESCAPE = /\\([\\"$`])/gu;
// Pieces are rejoined around control characters that shell commands do not contain, then split back into words.
const WORD_BREAK = "\u0000";
const SEGMENT_BREAK = "\u0001";

const pieceText = (piece: RegExpExecArray): string => {
  const pieceGroups: Readonly<Record<string, string | undefined>> = { ...piece.groups };
  const { singleQuoted, doubleQuoted, escaped, plainWord, segmentBreak } = pieceGroups;
  if (singleQuoted !== undefined) {
    return singleQuoted;
  }

  if (doubleQuoted !== undefined) {
    return doubleQuoted.replace(DOUBLE_QUOTED_ESCAPE, "$1");
  }

  if (escaped !== undefined) {
    return escaped === "\n" ? "" : escaped;
  }

  if (plainWord !== undefined) {
    return plainWord;
  }

  return segmentBreak === undefined ? WORD_BREAK : SEGMENT_BREAK;
};

// Splits a shell command into the words of each simple command, e.g. "kill $(pgrep -f vite)" into ["kill", "$"] and
// ["pgrep", "-f", "vite"].
export const shellSegments = (command: string): ReadonlyArray<ReadonlyArray<string>> => {
  const pieces = Array.from(command.matchAll(SHELL_PIECE), pieceText);
  const joinedPieces = pieces.join("");
  return joinedPieces
    .split(SEGMENT_BREAK)
    .map((segmentText) => segmentText.split(WORD_BREAK).filter((word) => word !== ""))
    .filter((segment) => segment.length > 0);
};
