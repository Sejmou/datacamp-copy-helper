import { multipleChoiceExerciseCrawler } from './page-crawlers/multiple-choice.js';
import { dragDropExerciseCrawler } from './page-crawlers/drag-drop.js';
import { overviewCrawler } from './page-crawlers/course-overview.js';
import { videoPageCrawler } from './page-crawlers/video-page.js';
import { videoIframeCrawler } from './page-crawlers/video-iframe.js';
import { exerciseCrawler } from './page-crawlers/code-exercise.js';
import {
  selectElements,
  selectSingleElement,
  getTextContent,
  getTextContents,
} from './util/dom.js';
import {
  HTMLTextLinksCodeToMarkdown,
  HTMLListToMarkdown,
} from './util/markdown-conversion.js';

// general config
export const includeTaskAndSolutionHeadings = true; // whether fitting subheadings for differentiating between task and task solution should be added automatically when copying exercises

// config for code exercises
const copyCodeOutputCheckboxInitState = true; // whether the checkbox for copying output of the code should be checked per default
const copyRSessionCodeComments = false;
const copyEmptyLines = true;
const copyEditorCodeFromConsoleOut = true; // whether editor code reappearing in the console output should also be copied - useful to keep track of what code produced what output
const copyOnlyConsoleOutOfCodeInEditor = true; // whether all previous output of the console that is not related to last execution of code currently in editor should be excluded when copying
const limitMaxLinesPerConsoleOut = true; // whether the maximum number of lines included when copying a single "thing" printed to the console should be limited when copying
const maxLinesPerConsoleOut = 20; // the maximum number of lines included when copying a single "thing" printed to the console (if limitMaxLinesPerConsoleOut true)
export const submitAnswerOnCopy = true; // whether the answer should automatically be submitted before copying it
export const pasteSubExercisesTogether = true; // CAUTION: possibly a bit buggy - try refreshing browser if it doesn't work first time! defines whether the instructions, code, and, optionally, output of all completed sub-exercises should be pasted together when copying (executing the code of each sub-exercise, too)
const includeConsoleOutInfoText = false; // Adds text indicating that the console output comes from R session on DataCamp, not local machine
const wideConsoleOutLinesStrategy = 'truncate'; // specify how to deal with console output that is too wide; options: 'wrap', 'truncate', 'none'
const maxConsoleOutLineWidth = 90; // recommended: 90 -> should be exactly width of regular R Markdown code cells
const splitConsoleOut = true; // whether a seperate code block should be created for each code statement that causes some console output; if false, all console output is put into the same code block; NOTE: currently only works if copyEditorCodeFromConsoleOut is also true

// TODO: remove this global const if/when refactoring the codebase
const warningSnackbarId = 'copy-helper-warning-snackbar';

export async function run() {
  const currentPage = await getCurrentPage();
  if (currentPage === 'other') {
    // nothing interesting to copy, just return directly!
    return;
  }

  const elementsAddedToDocument = [];
  const addToDocumentBody = el => {
    document.body.appendChild(el);
    elementsAddedToDocument.push(el);
  };

  const initialExercise = getURLQueryParams().ex;
  if (initialExercise) {
    // only reached when on an exercise page
    const detectExerciseChange = function () {
      const currentExercise = getURLQueryParams().ex;
      if (currentExercise != initialExercise) {
        handleExerciseChange();
      }
    };

    const detectionTimer = setInterval(detectExerciseChange, 1000); // apparently there's no event-based way to detect change in URL query

    const handleExerciseChange = () => {
      // cleanup
      elementsAddedToDocument.forEach(el => el.remove());
      // run script again to make sure elements relevant to new subpage are added
      run();
      clearInterval(detectionTimer); // after script was run on new page, remove exercise page change detection timer
    };
  }

  const copyInfoSnackbarId = 'copy-helper-info-snackbar';
  const copyInfoSnackbar = createSnackbar(copyInfoSnackbarId); // shows up when content is copied to clipboard
  const warningSnackbar = createSnackbar(
    warningSnackbarId,
    {
      top: '10%',
      left: '50%',
    },
    'yellow',
    5
  );

  const btn = createCopyButton();

  // on some pages we want to position the button differently
  // for this, we add a CSS class for the current page
  btn.classList.add(currentPage);

  const checkboxId = 'datacamp-copy-helper-checkbox';

  if (currentPage === 'video-iframe' || currentPage === 'exercise') {
    const checkboxContainer = createConsoleOutputToggleCheckbox(
      checkboxId,
      copyCodeOutputCheckboxInitState
    );
    addToDocumentBody(checkboxContainer);

    if (currentPage === 'video-iframe') {
      addSlideImageViewFeatures();
      checkboxContainer.classList.add('video-iframe');
    }
  }

  const pageCrawlers = new Map([
    ['overview', overviewCrawler],
    [
      'exercise',
      async () => {
        const includeConsoleOutput =
          document.getElementById(checkboxId).checked;
        return exerciseCrawler(
          includeConsoleOutput,
          pasteSubExercisesTogether,
          submitAnswerOnCopy,
          includeTaskAndSolutionHeadings
        );
      },
    ],
    [
      'dragdrop-exercise',
      () =>
        dragDropExerciseCrawler(
          includeTaskAndSolutionHeadings,
          submitAnswerOnCopy
        ),
    ],
    ['video', videoPageCrawler],
    [
      'video-iframe',
      () => {
        const includeCodeOutput = document.getElementById(checkboxId).checked;
        return videoIframeCrawler(includeCodeOutput);
      },
    ],
    [
      'mc-exercise',
      () =>
        multipleChoiceExerciseCrawler(
          submitAnswerOnCopy,
          includeTaskAndSolutionHeadings
        ),
    ],
  ]);

  const copyFn = async () => {
    const pageCrawler = pageCrawlers.get(currentPage);
    const clipboardContent = await pageCrawler();
    copyToClipboard(clipboardContent);
    showSnackbar(copyInfoSnackbarId, 'Copied R markdown to clipboard!');
  };
  btn.addEventListener('click', copyFn);

  document.addEventListener(
    'keydown',
    event => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === 'KeyC'
      ) {
        copyFn();
        event.preventDefault();
      }
    },
    { capture: true }
  );

  addToDocumentBody(btn);
  addToDocumentBody(copyInfoSnackbar);
  addToDocumentBody(warningSnackbar);
}

// apparently only working solution to copy to clipboard from Chrome Extension: https://stackoverflow.com/a/22702538 https://stackoverflow.com/a/60349158
function copyToClipboard(text) {
  const ta = document.createElement('textarea');
  ta.style.cssText =
    'opacity:0; position:fixed; width:1px; height:1px; top:0; left:0;';
  ta.value = text;
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

async function getCurrentPage() {
  // Here, we figure out what page (or iframe) the script is running on - this was not so trivial as expected lol
  // The DataCamp course content is loaded inside iframes on the course overview page, essentially creating isolated DOMs
  // We cannot access the content/DOM of the iframe from script instances running on the main page due to CORS issues!
  // However, luckily, TamperMonkey can also be loaded into iframes directly, as long as the iframe URL matches any @include in the meta tags
  // This means that in case iframes from datacamp are also loaded, several script instances may be running at the same time

  // We need to make everything async because of the video page
  // we cannot be sure that we're looking at the video page until the document body is modified and a certain element becomes available
  if (document.body.className.includes('js-application')) {
    return 'overview';
  } else if (document.querySelector('.slides')) {
    return 'video-iframe';
  } else if (document.querySelector('.drag-and-drop-exercise')) {
    return 'dragdrop-exercise';
  } else if (document.querySelector('.exercise--sidebar-header')) {
    return 'exercise';
  } else if (
    document.querySelector('[class*="dc-panel dc-u-h-100pc exercise__sidebar"]')
  ) {
    return 'mc-exercise';
  } else if (
    document.querySelector('[data-cy*="video-exercise"]')
    // video already loaded
  ) {
    return 'video';
  } else {
    return new Promise(resolve => {
      // page content not yet loaded
      // wait for relevant DOM elments to appear
      new MutationObserver((_, obs) => {
        if (document.querySelector('[data-cy*="video-exercise"]')) {
          resolve('video');
          obs.disconnect();
        } else if (document.querySelector('.drag-and-drop-exercise')) {
          resolve('dragdrop-exercise');
          obs.disconnect();
        } else if (
          document.querySelector(
            '[class*="dc-panel dc-u-h-100pc exercise__sidebar"]'
          )
        ) {
          resolve('mc-exercise');
          obs.disconnect();
        }
      }).observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }
}

async function submitAnswer() {
  const kbEvtInit = {
    key: 'Enter',
    code: 'Enter',
    location: 0,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    charCode: 0,
    keyCode: 13,
    which: 13,
    detail: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  dispatchKeyboardEvent(kbEvtInit);

  log('submitting answer');
  await answerSubmitted();
  log('answer submitted');
}

function dispatchKeyboardEvent(kbEvtInit) {
  const keyboardEvent = new KeyboardEvent('keydown', kbEvtInit);

  const activeElement = document.activeElement;
  document.body.focus();
  document.body.dispatchEvent(keyboardEvent);
  activeElement.focus();
}

async function answerSubmitted() {
  const consoleWrapper = document.querySelector('.console--wrapper');
  const submitAnswerButton = document.querySelector(
    '[data-cy="submit-button"]'
  );

  if (consoleWrapper) {
    return new Promise(resolve => {
      const submitButtonObs = new MutationObserver((recs, obs) => {
        // submit button is disabled once answer is submitted (but not immediately after submitting)

        // if the current exercise is an exercise without subexercises (or the last subexercise), we need to wait for the "continue" button to appear on the site
        if (document.querySelector('.dc-completed__continue')) {
          obs.disconnect();
          resolve();
        }

        // otherwise, (if the submitted exercise is a subexercise, but not the last one), we need to wait for the button to become available again
        // only then the current exercise is submitted completely and the relevant output is in the console
        const isEnabled = !submitAnswerButton.disabled;

        if (isEnabled) {
          obs.disconnect();

          const editorWrapper = selectSingleElement('[id*=editorTab]');

          // editor code for next exercise is not available immediately, it is added later
          // we need to wait for all code lines to appear
          // line numbers appear first, lines (.view-line containers) appear later, one-by-one
          let totalLineCount = Number.MAX_VALUE;
          let addedLinesCount = 0;
          const editorWrapperObs = new MutationObserver((recs, obs) => {
            if (addedLinesCount == totalLineCount) {
              obs.disconnect();
              resolve();
              return;
            }
            recs.forEach(rec => {
              if (rec.addedNodes?.length > 0) {
                const lineNumbersAdded =
                  rec.addedNodes[0].textContent.trim() === '1';
                if (lineNumbersAdded) {
                  totalLineCount = rec.addedNodes.length;
                }
                rec.addedNodes.forEach(el => {
                  if (el.className.includes('view-line')) {
                    addedLinesCount++;
                    if (addedLinesCount === totalLineCount) {
                      // for some reason, this line seems to never be reached in practice!?
                      obs.disconnect();
                      resolve();
                      return;
                    }
                  }
                });
              }
            });
          });

          editorWrapperObs.observe(editorWrapper, {
            childList: true,
            subtree: true,
          });
        }
      });
      submitButtonObs.observe(submitAnswerButton, {
        attributes: true,
        attributeFilter: ['disabled'],
      });
    });
  }
}

function getURLQueryParams() {
  return new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });
}

function removeComments(line) {
  const matchRes = line.match(/(.*(?<!["']))(#.*)/);
  if (!matchRes) {
    // line includes no comment
    return line;
  }
  const code = matchRes[1];
  return code;
}

function removeCommentsLinesStr(linesStr) {
  const noCommentLines = linesStr.split('\n').map(line => {
    if (line.trim().length === 0) {
      // keep regular empty lines
      return line;
    } else {
      const noCommentsLine = removeComments(line);
      // if line consists of only comments, we get back empty string
      if (noCommentsLine.trim().length === 0) {
        // use null as indicator that line should be removed!
        return null;
      }
      return noCommentsLine;
    }
  });

  return noCommentLines.filter(l => l !== null).join('\n');
}

function extractComments(line) {
  const matchRes = line.match(/(.*(?<!["']))(#.*)/);
  if (!matchRes) {
    // line includes no comment
    return '';
  }
  const comment = matchRes[2];
  return comment;
}

function addStyle(CSSText) {
  const style = document.createElement('style');
  style.appendChild(document.createTextNode(CSSText));
  document.querySelector('head').appendChild(style);
}

export async function getExerciseContent(
  includeConsoleOutput = true,
  pasteSubExercisesTogether = true,
  submitAnswer = true,
  includeTaskAndSolutionHeadings = true
) {
  const exerciseTitle = `## ${getTextContent('.exercise--title')}${
    includeTaskAndSolutionHeadings ? '\n### Exercise description' : ''
  }`;

  const exercisePars = selectElements('.exercise--assignment>div>*')
    .map(p => HTMLTextLinksCodeToMarkdown(p))
    .join('\n\n');

  const exerciseIntro = [exerciseTitle, exercisePars].join('\n');

  let exerciseBody = '';

  let subExIdx = getSubExerciseIndex();
  const hasSubexercises = subExIdx !== -1;

  if (!hasSubexercises) {
    if (includeTaskAndSolutionHeadings) exerciseBody += '### Task';
    exerciseBody += getExerciseInstructions();
    if (includeTaskAndSolutionHeadings) exerciseBody += '### Solution\n\n';
    exerciseBody += await getExerciseCode(includeConsoleOutput, submitAnswer);
  } else {
    if (includeTaskAndSolutionHeadings) exerciseBody += '### Tasks';
    if (pasteSubExercisesTogether) {
      while (getLinkToNextSubExercise()) {
        exerciseBody += getSubExerciseInstructions(subExIdx);
        exerciseBody += await getExerciseCode(
          includeConsoleOutput,
          submitAnswer
        );
        subExIdx++;
      }
    }

    exerciseBody += getSubExerciseInstructions(subExIdx);
    exerciseBody += await getExerciseCode(includeConsoleOutput, submitAnswer);
  }

  return exerciseIntro + '\n\n' + exerciseBody;
}

async function getExerciseCode(includeConsoleOutput, submitCodeInEditor) {
  const editors = selectElements('.monaco-editor');

  if (editors.length > 1) {
    const editorLines = await getEditorCodeLines();
    const editorCodeCompressed = editorLines.join('').replace(/\s/g, '');

    const codeWithComments = getEditorCodeBlock(
      editorLines
        .filter(l => copyEmptyLines || l.trim().length > 0)
        .join('\n')
        .replaceAll(' ', ' '), // for some reason, some weird ASCII character is used for spaces in code -> replace with regular space
      includeConsoleOutput
    );

    const code = copyRSessionCodeComments
      ? codeWithComments
      : removeCommentsLinesStr(codeWithComments);

    if (submitCodeInEditor) {
      await submitAnswer();
    }

    if (includeConsoleOutput) {
      const codeOutput = getConsoleOutput(editorCodeCompressed);
      return (
        [code, codeOutput].filter(str => str.length > 0).join('\n\n') + '\n\n'
      );
    } else return code + '\n\n';
  } else {
    if (includeConsoleOutput) {
      const consoleOutput = getConsoleOutput();
      return consoleOutput + '\n\n';
    }
  }
}

async function getEditorCodeLines() {
  // Annoying issue #1: not all editor code is added to DOM right away, only the part of it that is currently visible is added to DOM
  // Furthermore, every line marker and code line that moves out of the viewport is removed from the DOM
  // New DOM nodes are inserted once code scrolls back into view!

  // Annoying issue #2: code can be too long to fit into viewport width
  // The editor then does NOT add a horizontal scrollbar
  // Instead, an "artificial line break" is added, but the code line still remains the same

  // Annoying issue #3: line markers and code lines in the DOM are NOT necessarily sorted by their y-position
  // We have to sort them ourselves

  // That's why all this weird code is necessary...

  const lineMarkerContainer = selectElements('.margin-view-overlays')[0];

  const lineMarkers = Array.from(lineMarkerContainer.children);
  lineMarkers.sort(compareElementYPos);

  const extractLineNumbersFromLineMarkers = lineMarkers => {
    const lineNumbers = new Array(lineMarkers.length);
    for (let i = 0; i < lineNumbers.length; i++) {
      // textContent of lineMarker can either be valid line number string (>= 1), or empty
      // if we get back 0, we know that we actually observed an empty string
      // in this case, we know that this "artificially generated line" actually belongs to the previous observed code line
      const number = +lineMarkers[i].textContent.trim();
      lineNumbers[i] = !number ? lineNumbers[i - 1] : number;
    }

    return lineNumbers;
  };

  let lineNumbers = extractLineNumbersFromLineMarkers(lineMarkers);
  // As code lines are removed from the editor DOM content once it is scrolled down, the first few lines might be missing
  // could not figure out how to scroll up in editor (only scrolling down works lol), so best I can do is show a warning
  if (!(lineNumbers[0] <= 1)) {
    showWarning(
      `Editor not scrolled to top, code before line ${lineNumbers[0]} will not be copied`
    );
  }

  const linesContainer = selectElements('.view-lines')[0];
  const editorLines =
    lineNumbers.length == 0 ? [] : new Array(lineNumbers.at(-1) + 1).fill('');

  // the lines in the editor might contain "artificial line breaks", as explained above
  // we need to assign them to the correct "actual editor lines"
  const editorLinesUnprocessed = Array.from(linesContainer.children);
  editorLinesUnprocessed.sort(compareElementYPos);

  // divider between code editor and console -> lower border for the code editor viewport
  const editorViewportBottom = selectSingleElement(
    '.lm_splitter.lm_vertical .lm_drag_handle'
  );

  const editorWindow = selectElements('.overflow-guard')[0];

  if (isAboveOrOverlapping(editorViewportBottom, lineMarkers.at(-1))) {
    // some parts of the code are still "unseen" -> we need to scroll all the remaining stuff into view
    let y = 0;

    while (isAboveOrOverlapping(editorViewportBottom, lineMarkers.at(-1))) {
      y += 50;
      editorWindow.scrollTop = y;

      // TODO: think about better approach for this
      const newLineNumbersAdded = () =>
        new Promise(resolve => {
          const newLineMarkerObs = new MutationObserver((recs, obs) => {
            recs.forEach(rec => {
              const newLineMarkers = Array.from(rec.addedNodes);
              if (newLineMarkers.length > 0) {
                lineMarkers.push(...newLineMarkers); // don't forget to destructure lol
                lineMarkers.sort(compareElementYPos);
                lineNumbers = extractLineNumbersFromLineMarkers(lineMarkers);
              }
            });
            obs.disconnect();
            resolve();
          });

          newLineMarkerObs.observe(lineMarkerContainer, { childList: true });
        });

      const newLinesAdded = () =>
        new Promise(resolve => {
          const newLineObs = new MutationObserver((recs, obs) => {
            recs.forEach(rec => {
              const newLines = Array.from(rec.addedNodes);
              if (newLines.length > 0) {
                editorLinesUnprocessed.push(...newLines);
                editorLinesUnprocessed.sort(compareElementYPos);
              }
            });
            obs.disconnect();
            resolve();
          });

          newLineObs.observe(linesContainer, { childList: true });
        });

      await Promise.all([newLineNumbersAdded(), newLinesAdded()]);
    }
  }

  const addToEditorLines = (viewLine, viewLineIdx) => {
    const lineContent = viewLine.textContent;
    const codeLineIdx = lineNumbers[viewLineIdx] - 1; // subtract 1 as codeLines begin with 1 but array indices start with 0
    if (editorLines[codeLineIdx] === undefined) {
      editorLines[codeLineIdx] = '';
    }
    editorLines[codeLineIdx] += lineContent;
  };

  editorLinesUnprocessed.forEach(addToEditorLines);

  return editorLines;
}

// useful when DOM element ordering does NOT correspond to vertical position on page
// e.g. as argument to Array.prototype.sort()
function compareElementYPos(a, b) {
  return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
}

function isAboveOrOverlapping(domElementA, domElementB) {
  const [a, b] = [domElementA, domElementB];
  const aTop = a.getBoundingClientRect().top;
  const bBottom = b.getBoundingClientRect().bottom;
  return aTop <= bBottom;
}

function getLinkToNextSubExercise() {
  return getCodeSubExerciseLink(1);
}

function getSubExerciseIndex() {
  const subExerciseBullets = selectElements(
    // selectors for horizontally and vertically arranged bullets
    '.progress-bullet__link, .bullet-instructions-list .bullet-instruction'
  );

  const currSubExerciseIdx = subExerciseBullets.findIndex(b =>
    b.className.includes('active')
  );

  return currSubExerciseIdx;
}

function getCodeSubExerciseLink(offsetFromCurrent) {
  const subExerciseBullets = selectElements(
    // selectors for horizontally and vertically arranged bullets
    '.progress-bullet__link, .bullet-instructions-list .bullet-instruction'
  );

  const currSubExerciseIdx = subExerciseBullets.findIndex(b =>
    b.className.includes('active')
  );

  return subExerciseBullets[currSubExerciseIdx + offsetFromCurrent];
}

function getEditorCodeBlock(code, evaluate) {
  const RCodeBlock =
    `\`\`\`{r${evaluate ? ', eval=FALSE' : ''}}\n` + code + '\n```';

  return RCodeBlock;
}

function getConsoleOutput(editorCodeCompressed = '') {
  const consoleOutDivContents = getTextContents(
    '[data-cy="console-editor"]>div>div>div'
  );

  let coutObjs = consoleOutDivContents
    .filter(
      (content, i, arr) =>
        // filter out empty lines
        !!content &&
        // sometimes (but for some reason not always!?), final line (input for new code) without output is also included -> remove
        !(content.startsWith('>') && i === arr.length - 1)
    )
    .map(content => ({
      content,
      contentCompressed: content.replace(/\s/g, ''),
      containsEditorCode: false,
    }));

  coutObjs = processEditorCode(
    coutObjs,
    editorCodeCompressed,
    copyOnlyConsoleOutOfCodeInEditor
  );

  if (!copyRSessionCodeComments) {
    coutObjs = removeConsoleComments(coutObjs);
  }

  if (copyEditorCodeFromConsoleOut) {
    // mark code that comes from editor (is input to console) with '> '
    coutObjs.forEach(obj => {
      if (obj.containsEditorCode) {
        obj.content = '> ' + obj.content;
      }
    });
  } else {
    coutObjs = coutObjs.filter(obj => !obj.containsEditorCode);
  }

  applyWrappingStrategy(coutObjs, wideConsoleOutLinesStrategy);

  const coutStrs = createConsoleOutStrs(coutObjs, splitConsoleOut);

  const coutCodeBlockStrs = coutStrs
    .map(coutStr => (coutStr.length > 0 ? '```\n' + coutStr + '\n```' : ''))
    .join('\n\n');

  const consoleOutInfoText = includeConsoleOutInfoText
    ? 'The following output was produced in the R Session on DataCamp:\n'
    : '';

  // if ggplot() is used in the plot, mention plot output that should be produced
  // TODO: if very motivated, check if ggplot() is actually called in the code, not just mentioned anywhere in the code (including comments)
  const plotInfoText = editorCodeCompressed.includes('ggplot(')
    ? 'The code creates the following plot:'
    : '';

  return [consoleOutInfoText, coutCodeBlockStrs, plotInfoText]
    .filter(str => str.length > 0)
    .join('\n\n');
}

function createConsoleOutStrs(coutObjs, split) {
  if (!split) {
    return [coutObjs.map(obj => obj.content).join('\n\n')];
  }

  const coutStrs = [];

  let i = 0;
  coutObjs.forEach((obj, j, arr) => {
    if (
      arr[j - 1] &&
      !arr[j - 1].containsEditorCode &&
      obj.containsEditorCode
    ) {
      i++;
    }

    if (!coutStrs[i]) {
      coutStrs[i] = obj.content;
    } else {
      coutStrs[i] += '\n\n' + obj.content;
    }
  });

  return coutStrs;
}

function removeConsoleComments(coutObjs) {
  return coutObjs.filter(obj => {
    HTMLListToMarkdown;
    // we need to check for comments in the editor code from the console and filter them out
    if (obj.containsEditorCode) {
      obj.content = removeComments(obj.content);
      // include output only if content not empty after removing comments
      return obj.content.trim().length > 0;
    }

    // regular console output should always be included
    return true;
  });
}

function processEditorCode(coutObjs, editorCodeCompressed, filter = true) {
  // goal: Find index of last console output content that is relevant for copying and slice coutObjs accordingly, if filter is true
  // if we don't find that index, we can also warn the user that the code was not found in the output

  // For content to be relevant, it must satisfy the following conditions:
  // 1. content is identical to the beginning of the code in the editor (if whitespace and comments are removed in both) - only code from this line onwards can be relevant
  // 2. all editor lines should be included in the content of the console content following the content that was found
  let idxOfObjMarkingStartOfLastCodeOutput = -1; // -1 indicates "not found"

  let remainingEditorCode = editorCodeCompressed;

  for (let i = coutObjs.length - 1; i >= 0; i--) {
    const contentCompressed = coutObjs[i].contentCompressed;
    if (remainingEditorCode.endsWith(contentCompressed)) {
      coutObjs[i].containsEditorCode = true;
      remainingEditorCode = remainingEditorCode.substring(
        0,
        remainingEditorCode.lastIndexOf(contentCompressed)
      );
      if (!remainingEditorCode) {
        idxOfObjMarkingStartOfLastCodeOutput = i;
        break;
      }
    }
  }

  if (editorCodeCompressed && idxOfObjMarkingStartOfLastCodeOutput === -1) {
    showWarning(
      'The code you wrote was not found in the console output. Did you forget to run it?'
    );
  }

  if (filter && idxOfObjMarkingStartOfLastCodeOutput >= 0) {
    return coutObjs.slice(idxOfObjMarkingStartOfLastCodeOutput);
  }

  return coutObjs;
}

function applyWrappingStrategy(coutObjs, strategy) {
  let linesWereTruncated = false;

  coutObjs.forEach(obj => {
    if (strategy === 'wrap') {
      // split too wide lines across multiple lines
      obj.content = wrapTooWideLines(obj.content, maxConsoleOutLineWidth);
    } else if (strategy === 'truncate') {
      obj.content = truncateTooWideLines(obj.content, maxConsoleOutLineWidth);
    }

    if (limitMaxLinesPerConsoleOut) {
      const lines = obj.content.split('\n');
      const truncatedLines = lines.slice(0, maxLinesPerConsoleOut);
      const removedLineCount = lines.length - truncatedLines.length;
      if (removedLineCount > 0) {
        linesWereTruncated = true;
        truncatedLines.push(
          `... (${removedLineCount} lines removed for readability reasons)`
        );
      }
      obj.content = truncatedLines.join('\n');
    }
  });

  return linesWereTruncated;
}

function wrapTooWideLines(linesStr, maxWidth) {
  return linesStr
    .split('\n')
    .map(l => {
      if (l.length <= maxWidth) {
        return l;
      }

      const chunks = [];

      for (let i = 0, lLength = l.length; i < lLength; i += maxWidth) {
        chunks.push(l.substring(i, i + maxWidth));
      }

      return chunks.join('\n');
    })
    .join('\n');
}

function truncateTooWideLines(linesStr, maxWidth) {
  return linesStr
    .split('\n')
    .map(l => {
      if (l.length <= maxWidth) {
        return l;
      }
      return l.substring(0, maxWidth + 1) + ' ...';
    })
    .join('\n');
}

function getExerciseInstructions() {
  const instructions = selectElements('.exercise--instructions>*')
    .map(el => {
      return Array.from(el.children)
        .map(el => {
          const textContent = el.textContent.trim();
          if (el.nodeName === 'H4') return `### ${textContent}`; // This is usually the "Question" heading - probably irrelevant for copying
          if (el.nodeName === 'H5') return `#### ${textContent}`; // This is usually "Possible answers" heading - also probably irrelevant
          if (el.nodeName === 'UL') return HTMLListToMarkdown(el) + '\n';
          if (
            el.className.includes('actions') ||
            el.className.includes('feedback')
          )
            return ''; // actions are buttons etc. -> text is irrelevant
          else return textContent;
        })
        .filter(str => str.trim().length > 0)
        .join('\n');
    })
    .join('\n');

  return '\n' + instructions;
}

function getSubExerciseInstructions(idx = 0) {
  // two "sub-exercise layouts" are possible:
  // 1. instructions for every step are listed in containers (one after the other)
  // 2. only instructions for the current step are listed
  //   to see instructions for next step:
  //    * complete current exercise OR
  //    * click link to next exercise (if available)

  // if this container exists, we're dealing with case 1
  const instructionsContainer = document.querySelector(
    '.bullet-instructions-list'
  );

  const currentInstructionEls = instructionsContainer
    ? Array.from(
        document.querySelectorAll(
          '.bullet-instructions-list__instruction-content .exercise--instructions__content'
        )[idx]?.children || []
      )
    : selectElements('.exercise--instructions__content>*');

  const currentInstructions = currentInstructionEls
    .map(HTMLTextLinksCodeToMarkdown)
    .join('\n');

  return (
    ` ${idx + 1}.\n` +
    currentInstructions
      .split('\n')
      .map(line => '    ' + line)
      .join('\n')
  );
}

function addSlideImageViewFeatures() {
  const imgs = selectElements(
    '.slide-content img:not([class]), .slide-content img[class=""]'
  ).map(img => img.cloneNode(true));

  const imgClass = 'copy-helper-slide-imgs';

  imgs.forEach(img => document.body.appendChild(img));

  if (imgs.length > 0) {
    const slideImgBtnClass = 'copy-helper-slide-images-btn';
    const visibleClass = 'visible';
    const prevSlideImgBtnId = 'copy-helper-prev-slide-image-btn';
    const nextSlideImgBtnId = 'copy-helper-next-slide-image-btn';
    // TODO: comment out once download actually works lol
    // const downloadSlideImgBtnId = 'copy-helper-slide--image-download-btn';

    const viewSlideImageToggleBtn = createButton(
      'view slide images',
      null,
      slideImgBtnClass
    );
    const prevSlideImgBtn = createButton('prev', prevSlideImgBtnId);
    const nextSlideImgBtn = createButton('next', nextSlideImgBtnId);
    // TODO: comment out once download actually works lol
    // const downloadSlideImgBtn = createButton(
    //   'download current image',
    //   downloadSlideImgBtnId
    // );

    const ctrlBtns = [prevSlideImgBtn, nextSlideImgBtn];

    const backgroundDiv = document.createElement('div');
    const backgroundDivId = 'copy-helper-slide-image-background';

    let currImgIdx = 0;
    let showSlideImgs = false;

    const incImgIdx = () => {
      if (currImgIdx < imgs.length - 1) currImgIdx++;
      imgs.forEach((img, i) => {
        img.className = i === currImgIdx ? imgClass : '';
      });
      imgs[currImgIdx].classList.add(imgClass);
      nextSlideImgBtn.disabled = currImgIdx >= imgs.length - 1;
      prevSlideImgBtn.disabled = currImgIdx <= 0;
    };

    const decImgIdx = () => {
      if (currImgIdx > 0) currImgIdx--;
      imgs.forEach((img, i) => {
        img.className = i === currImgIdx ? imgClass : '';
      });
      imgs[currImgIdx].classList.add(visibleClass);
      nextSlideImgBtn.disabled = currImgIdx >= imgs.length - 1;
      prevSlideImgBtn.disabled = currImgIdx <= 0;
    };

    prevSlideImgBtn.addEventListener('click', decImgIdx);
    nextSlideImgBtn.addEventListener('click', incImgIdx);

    viewSlideImageToggleBtn.addEventListener('click', () => {
      showSlideImgs = !showSlideImgs;
      imgs.forEach((img, i) => {
        img.className = showSlideImgs && i === currImgIdx ? imgClass : '';
      });

      ctrlBtns.forEach(btn => {
        btn.className =
          showSlideImgs && imgs.length > 1 ? slideImgBtnClass : '';
      });

      backgroundDiv.id = showSlideImgs ? backgroundDivId : '';

      // TODO: comment out once download actually works lol
      //downloadSlideImgBtn.id = showSlideImgs ? downloadSlideImgBtnId : '';

      viewSlideImageToggleBtn.innerText = !showSlideImgs
        ? 'view slide images'
        : 'close slide image view';

      if (showSlideImgs) {
        selectSingleElement('video').pause();
      }
    });

    document.body.addEventListener(
      'keydown',
      e => {
        const leftKey = 'ArrowLeft';
        const rightKey = 'ArrowRight';
        const arrowKeys = [leftKey, rightKey];
        if (showSlideImgs && arrowKeys.includes(e.key)) {
          e.stopPropagation();
          if (e.key == leftKey) {
            decImgIdx();
          }
          if (e.key == rightKey) {
            incImgIdx();
          }
        }
      },
      { capture: true }
    );

    document.body.appendChild(viewSlideImageToggleBtn);
    ctrlBtns.forEach(btn => document.body.appendChild(btn));
    document.body.appendChild(backgroundDiv);

    addStyle(`
  .${slideImgBtnClass} {
    position: fixed;
    top: 40px;
    right: 10px;
    z-index: 999;
    transition: 0.25s all;
  }

  .${slideImgBtnClass}:active {
    transform: scale(0.92);
    box-shadow: 3px 2px 22px 1px rgba(0, 0, 0, 0.24);
  }

  img.${imgClass} {
    z-index: 997 !important;
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    max-height: 85vh !important;
    max-width: 100vw !important;
    display: block;
    transform: translate(-50%, -50%);
  }

  #${backgroundDivId} {
    z-index: 996;
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: #FFFFFF;
  }

  #${nextSlideImgBtnId} {
    top: unset;
    bottom: 10px;
    left: 51%;
    right: unset;
  }

  #${prevSlideImgBtnId} {
    top: unset;
    bottom: 10px;
    right: 51%;
    left: unset;
  }
  `);
    //TODO: add those styles once download actually works
    // #${downloadSlideImgBtnId} {
    //   /* if visible, displayed right above 'Copy to clipboard' button */
    //   top: 10px;
    //   right: 10px;
    //   z-index: 1000;
    // }
  }
}

function createCopyButton() {
  const btnId = 'copy-helper-btn';
  const btn = createButton('copy to clipboard', btnId);

  addStyle(`
  #${btnId} {
    position: fixed;
    top: 51px;
    right: 350px;
    z-index: 999;
    transition: 0.25s all;
  }

  #${btnId}:active {
    transform: scale(0.92);
    box-shadow: 3px 2px 22px 1px rgba(0, 0, 0, 0.24);
  }

  /*The following two classes help us position the button better for specific sites*/
  #${btnId}.overview { 
    top: 40px;
    right: 40px;
  }

  #${btnId}.video-iframe {
    top: 10px;
    right: 10px;
  }

  #${btnId}.video, #${btnId}.dragdrop-exercise, #${btnId}.mc-exercise {
    top: 70px;
    right: 70px;
  }
  `);

  return btn;
}

function createButton(text, id = null, className = null) {
  const btn = document.createElement('button');
  if (id) btn.id = id;
  if (className) btn.className = className;
  btn.innerText = text;
  btn.type = 'button';
  return btn;
}

function createSnackbar(
  id,
  pos = { top: '50%', left: '50%' },
  textColor = 'white',
  animationDuration = 3
) {
  const posCss = createObjWithTruthyValuesForProps(
    ['top', 'right', 'bottom', 'left'],
    pos
  );

  addStyle(`
  #${id} {
    display: none;
    background-color: #333;
    color: ${textColor};
    text-align: center;
    border-radius: 2px;
    padding: 16px;
    position: fixed;
    z-index: 9999;
    ${objToCssPropsAndValsStr(posCss)}
    transform: translate(-50%, -50%);
  }
  
  #${id}.visible {
    /* https://stackoverflow.com/a/49546937/13727176 */
    animation-fill-mode: forwards;
    animation-name: fade-in, fade-out;
    animation-delay: 0s, ${animationDuration - 0.25}s;
    animation-duration: 0.25s; /* same for both */
    display: flex;
  }
  
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 0.9;
    }
  }

  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }

  `);

  const snackbar = document.createElement('div');
  snackbar.id = id;

  return snackbar;
}

function showWarning(msg) {
  showSnackbar(warningSnackbarId, `Warning: ${msg}`);
}

function showSnackbar(id, text) {
  const snackbar = document?.getElementById(id);
  snackbar.remove();
  document.body.appendChild(snackbar);

  if (snackbar) {
    snackbar.innerText = text;
    snackbar.classList.add('visible');
  } else {
    console.warn('Snackbar with ID', id, 'not found!');
  }
}

function createConsoleOutputToggleCheckbox(checkboxId, initialState) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = checkboxId;
  checkbox.checked = initialState;

  const label = document.createElement('label');
  label.htmlFor = checkboxId;
  label.appendChild(document.createTextNode('include code output?'));

  const container = document.createElement('div');
  const containerId = checkboxId + 'container';
  container.id = containerId;

  container.appendChild(checkbox);
  container.appendChild(label);

  addStyle(`
    #${containerId} {
      position: fixed;
      top: 51px;
      right: 140px;
      z-index: 999;
      color: white;
      display: flex;
      justify-content: center;
      height: 30px;
      align-items: center;
      gap: 10px;
    }

    #${containerId}.video-iframe {
      color: black;
      right: 164px;
      top: 7px;
    }
  
    #${containerId}:hover, #${containerId} *:hover {
      cursor: pointer;
    }
  `);

  return container;
}

// creates new object from inputObj with only those props that are in the given array of props and have a truthy value in inputObj
function createObjWithTruthyValuesForProps(props, inputObj) {
  return props.reduce((prev, propName) => {
    const propVal = inputObj[propName];
    if (propVal) {
      return { ...prev, [propName]: propVal };
    }
    return prev;
  }, {});
}

function objToCssPropsAndValsStr(obj) {
  return Object.entries(obj)
    .map(([prop, val]) => `${prop}: ${val};`)
    .join('\n');
}

function log(...content) {
  console.log('[DataCamp copy helper]', ...content);
}
