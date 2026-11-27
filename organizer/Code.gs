function onOpen() {
  SpreadsheetApp.getUi().createMenu('NASTI 1')
    .addItem('Update static.csv', 'updateStatic')
    .addItem('Update scores.csv', 'updateScores')
    .addToUi();
}

function updateStatic() { showPublisher_('Update static.csv'); }
function updateScores() { showPublisher_('Update scores.csv'); }

function showPublisher_(title) {
  const page = HtmlService.createTemplateFromFile('Publisher');
  SpreadsheetApp.getUi().showModalDialog(page.evaluate().setWidth(620).setHeight(520), title);
}

function settings_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  for (const key of ['STATIC_ID', 'SCORES_ID', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_TOKEN', 'CSV_KEY', 'ACCESS_EXPIRES']) {
    if (!p[key]) throw new Error('Missing Script Property: ' + key);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(p.GITHUB_REPO)) throw new Error('Invalid GITHUB_REPO');
  if (!/^[\w.-]+$/.test(p.GITHUB_BRANCH)) throw new Error('Invalid GITHUB_BRANCH');
  if (!/^[\w-]{43}$/.test(p.CSV_KEY)) throw new Error('Invalid CSV_KEY');
  p.expires = Date.parse(p.ACCESS_EXPIRES);
  if (!Number.isSafeInteger(p.expires) || p.expires <= Date.now()) throw new Error('Set a future ACCESS_EXPIRES');
  return p;
}

function github_(p, method, path, body) {
  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + p.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true,
    followRedirects: false
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const reply = UrlFetchApp.fetch('https://api.github.com/repos/' + p.GITHUB_REPO + path, options);
  const status = reply.getResponseCode();
  if (status === 404 && method === 'get' && path.startsWith('/contents/')) return null;
  if (status < 200 || status >= 300) throw new Error('GitHub update failed (HTTP ' + status + ')');
  return JSON.parse(reply.getContentText());
}

function head_(p) {
  return github_(p, 'get', '/git/ref/heads/' + p.GITHUB_BRANCH).object.sha;
}

function readSheet_(id, name, tab) {
  const book = SpreadsheetApp.openById(id);
  if (book.getName() !== name) throw new Error('Expected spreadsheet named ' + name);
  const sheets = book.getSheets();
  const sheet = tab ? book.getSheetByName(tab) : sheets.length === 1 ? sheets[0] : null;
  if (!sheet) throw new Error('Set the data tab for ' + name + ' in Script Properties');
  return sheet.getDataRange().getDisplayValues().map(row =>
    row.map(cell => '"' + cell.replace(/"/g, '""') + '"').join(',')
  ).join('\n') + '\n';
}

function source_(p) {
  const roster = readSheet_(p.STATIC_ID, 'Static', p.STATIC_TAB);
  const scores = readSheet_(p.SCORES_ID, 'Scores', p.SCORES_TAB);
  const hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify([roster, scores, p.CSV_KEY, p.expires,
      p.GITHUB_REPO, p.GITHUB_BRANCH]), Utilities.Charset.UTF_8));
  return { roster, scores, hash };
}

function lockedSchedule_(p, sha) {
  const old = github_(p, 'get', '/contents/NASTI1/static.csv?ref=' + sha);
  if (!old) return '';
  const content = Utilities.newBlob(Utilities.base64Decode(old.content.replace(/\s/g, ''))).getDataAsString();
  if (!content.trim().startsWith('{')) return '';
  const envelope = JSON.parse(content);
  if (envelope.version !== 1 || envelope.kind !== 'static' ||
      !/^(|[\w-]{43})$/.test(envelope.schedule)) throw new Error('Invalid existing roster envelope');
  return envelope.schedule;
}

function previewPublication() {
  const p = settings_();
  const sha = head_(p);
  return { ...source_(p), sha, frozen: lockedSchedule_(p, sha), secret: p.CSV_KEY, expires: p.expires };
}

function validateEnvelope_(file, kind, p) {
  const base64 = /^[A-Za-z0-9_-]+$/;
  if (typeof file !== 'string' || file.length > 500000) throw new Error('Invalid encrypted file size');
  const e = JSON.parse(file);
  if (Object.keys(e).sort().join(',') !== 'batch,ciphertext,expires,iv,kind,schedule,version' ||
      e.version !== 1 || e.kind !== kind || e.expires !== p.expires ||
      typeof e.batch !== 'string' || !/^[a-f0-9-]{36}$/.test(e.batch) ||
      typeof e.iv !== 'string' || e.iv.length !== 16 || !base64.test(e.iv) ||
      typeof e.ciphertext !== 'string' || e.ciphertext.length < 22 || !base64.test(e.ciphertext) ||
      typeof e.schedule !== 'string' || !/^(|[\w-]{43})$/.test(e.schedule)) {
    throw new Error('Invalid encrypted file');
  }
  return e;
}

function publishTournament(request) {
  const p = settings_();
  const roster = validateEnvelope_(request.roster, 'static', p);
  const scores = validateEnvelope_(request.scores, 'scores', p);
  if (roster.batch !== scores.batch || roster.schedule !== scores.schedule || roster.iv === scores.iv) {
    throw new Error('Encrypted files do not form a publishing batch');
  }
  const current = head_(p);
  if (current !== request.sha || source_(p).hash !== request.hash) {
    throw new Error('Sheets or branch changed. Open a new preview.');
  }
  const frozen = lockedSchedule_(p, current);
  if (frozen && roster.schedule !== frozen) throw new Error('Schedule is frozen');
  const parent = github_(p, 'get', '/git/commits/' + current);
  const tree = github_(p, 'post', '/git/trees', {
    base_tree: parent.tree.sha,
    tree: [
      { path: 'NASTI1/static.csv', mode: '100644', type: 'blob', content: request.roster },
      { path: 'NASTI1/scores.csv', mode: '100644', type: 'blob', content: request.scores }
    ]
  });
  const commit = github_(p, 'post', '/git/commits', {
    message: 'Publish encrypted NASTI 1 tournament data',
    tree: tree.sha,
    parents: [current]
  });
  github_(p, 'patch', '/git/refs/heads/' + p.GITHUB_BRANCH, { sha: commit.sha, force: false });
  return commit.sha;
}
