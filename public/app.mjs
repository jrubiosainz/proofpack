const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const short = value => String(value).slice(0, 12);
const stateLabels = { verified: 'Verified', stale: 'Stale', missing: 'No evidence', failed: 'Failed', invalid: 'Invalid' };
const pages = {
  requirements: { number: '01', label: 'Define requirements', title: 'Requirements, backed by proof.', description: 'Start with a small acceptance contract. Every requirement links to code, a test and an exact piece of evidence.', stage: 'initial' },
  change: { number: '02', label: 'Change the scope', title: 'A scope change invalidates the pass.', description: 'The questions and documents are unchanged. The acceptance contract is not. An earlier pass cannot cover a new requirement.', stage: 'changed' },
  evidence: { number: '03', label: 'Inspect fresh evidence', title: 'Fresh evidence. Inspectable answers.', description: 'A new approval and fixture run bind the answers to the current scope. Follow each claim back to its approved source.', stage: 'validated' },
};
let view;
let selectedCase = 'CASE-01';
const app = document.querySelector('#app');
const loadState = document.querySelector('#load-state');

function gateBanner(stage) {
  const passed = stage.gate.status === 'passed';
  const stale = stage.gate.rows.filter(row => row.state === 'stale').length;
  const missing = stage.gate.rows.filter(row => row.state === 'missing').length;
  return `<div class="gate-banner ${passed ? 'pass-banner' : 'blocked-banner'}" data-testid="gate-banner">
    <div><span class="badge ${passed ? 'verified' : 'stale'}">${passed ? 'SCOPE CHECK PASSED' : 'ACCEPTANCE BLOCKED'}</span>
      <strong>${stage.gate.passed} / ${stage.gate.total} checks ${passed ? 'verified' : 'applicable and verified'}</strong></div>
    <p>${passed ? 'Exact scope. Exact inputs. Recomputed checks.' : `${stale} stale checks &middot; ${missing} without current evidence`}</p>
  </div>`;
}

function stats(stage) {
  return `<div class="stats">
    <div><span>Active scope</span><strong>v${stage.scopeVersion}</strong><small>SHA-256 ${h(short(stage.gate.scopeHash))}</small></div>
    <div><span>Fixed acceptance cases</span><strong>${view.cases.length}</strong><small>Same questions and corpus in both scopes</small></div>
    <div><span>Model calls</span><strong>${view.latest.execution.providerAttempts}</strong><small>Deterministic fixture, not an LLM</small></div>
  </div>`;
}

function requirementTable(stage) {
  return `<section class="panel" aria-labelledby="matrix-title">
    <div class="panel-heading"><div><span class="eyebrow">EXECUTABLE CONTRACT</span><h2 id="matrix-title">Requirement-to-evidence matrix</h2></div><span class="subtle">Scope v${stage.scopeVersion}</span></div>
    <div class="table-wrap"><table data-testid="requirement-matrix">
      <caption class="sr-only">Current requirement checks and the applicability of this report</caption>
      <thead><tr><th scope="col">ID</th><th scope="col">Acceptance check</th><th scope="col">Cases</th><th scope="col">Evidence state</th></tr></thead>
      <tbody>${stage.gate.rows.map(row => `<tr data-requirement="${h(row.id)}">
        <th scope="row"><span class="requirement-id">${h(row.id)}</span>${row.introducedInScope === 2 ? '<small class="new-label">ADDED</small>' : ''}</th>
        <td><strong>${h(row.title)}</strong><p>${h(row.criterion)}</p></td>
        <td class="case-count">${row.caseIds.length} ${row.caseIds.length === 1 ? 'case' : 'cases'}</td>
        <td><span class="badge ${h(row.state)}">${h(stateLabels[row.state])}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <details class="trace-links"><summary>Inspect implementation and test links</summary>
      ${stage.gate.rows.map(row => `<p><strong>${h(row.id)} &middot; ${h(row.checkId)}</strong><br><code>${h(row.code.join(' | '))}</code><br><code>${h(row.tests.join(' | '))}</code></p>`).join('')}
    </details>
  </section>`;
}

function approvalNote() {
  return `<div class="approval-note"><span class="approval-icon" aria-hidden="true">H</span><div><strong>Human release review: pending</strong><p>A passing technical gate is not authorization to release. Demo approval is an automated, scope-bound step.</p></div><span class="badge neutral">SEPARATE GATE</span></div>`;
}

function renderRequirements(stage, changed) {
  return `${changed ? `<div class="change-note"><div><span class="eyebrow">CHG-001 &middot; NEW REQUIREMENT</span><strong>Make abstention actionable.</strong><p>Show the approved support route and reason when evidence is missing. Do not create a ticket.</p></div><span class="badge stale">R-05 ADDED</span></div>` : ''}
    ${gateBanner(stage)}${stats(stage)}${requirementTable(stage)}
    ${changed ? '<p class="method-note">The unchanged scope-v1 report is checked against scope v2. R-01 to R-04 become stale; R-05 has no applicable evidence. A new approval and report are required.</p>' : '<p class="method-note">This is a passing scope-v1 fixture, not a production evaluation. Next, change the acceptance contract without changing its questions.</p>'}
    ${approvalNote()}`;
}

function answerDetail(result) {
  const answer = result.answer;
  const supported = answer.disposition === 'answer';
  return `<article class="answer-detail" aria-labelledby="answer-title">
    <div class="answer-header"><span class="eyebrow">${h(result.caseId)} &middot; ${h(result.title)}</span><span class="badge ${supported ? 'verified' : 'neutral'}">${supported ? 'SUPPORTED' : 'ABSTAIN + ROUTE'}</span></div>
    <div class="question"><span class="eyebrow">QUESTION</span><p>${h(result.question)}</p></div>
    <h3 id="answer-title">${supported ? 'Validated answer' : 'Validated abstention'}</h3>
    <p class="answer-text" data-testid="answer-text">${h(answer.text)}</p>
    ${supported ? `<div class="citation"><span class="eyebrow">APPROVED SOURCE</span>${answer.citations.map(citation => `<strong>${h(citation.documentId)} <span class="subtle">/ v${h(citation.documentVersion)} / ${h(citation.factId)}</span></strong><details><summary>Read the exact source quote</summary><blockquote>${h(citation.quote)}</blockquote></details>`).join('')}<span class="literal-match">Literal text and versioned citation match</span></div>`
      : `<div class="support-route"><span class="eyebrow">APPROVED DEMO ROUTE</span><strong>${h(answer.escalation.channel)}</strong><code>${h(answer.escalation.url)}</code><span class="reason-code">${h(answer.escalation.reasonCode)}</span><p>${h(answer.escalation.notice)}</p><span class="badge neutral">ticketCreated: false</span></div>`}
    <p class="fixture-caption">English synthetic fixture output. Not a recorded or translated model completion.</p>
  </article>`;
}

function renderEvidence(stage) {
  const result = stage.evidence.responses.find(item => item.caseId === selectedCase);
  return `${gateBanner(stage)}${stats(stage)}
    <section class="panel evidence-panel" aria-labelledby="evidence-title">
      <div class="panel-heading"><div><span class="eyebrow">FROM REQUIREMENT TO ANSWER</span><h2 id="evidence-title">Inspect the evidence</h2></div><a class="download-link" href="/evidence.json" download="proofpack-fixture.json">Download report</a></div>
      <div class="case-layout"><div class="case-list" aria-label="Select an acceptance case">${stage.evidence.responses.map(item => `<button type="button" data-case="${h(item.caseId)}" aria-pressed="${item.caseId === selectedCase}" class="case-button ${item.caseId === selectedCase ? 'selected' : ''}"><span>${h(item.caseId)} <span class="case-mark">${item.passed ? 'PASS' : 'FAIL'}</span></span><strong>${h(item.title)}</strong><small>${item.answer.disposition === 'answer' ? 'Exact approved text + citation' : 'Abstain + explicit support route'}</small></button>`).join('')}<div class="case-list-note">Selection is bounded to approved fact IDs. The renderer supplies the answer text.</div></div>${answerDetail(result)}</div>
      <div class="binding-strip"><span><strong>Source snapshot</strong> <code>${h(short(stage.evidence.source.contentHash))}</code></span><span><strong>Report SHA-256</strong> <code>${h(short(stage.evidence.integrity.contentHash))}</code></span><span>Unsigned change-detection hashes</span></div>
    </section>${approvalNote()}`;
}

function render() {
  const key = Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'requirements';
  const page = pages[key];
  const stage = view.stages[page.stage];
  document.title = `ProofPack | ${page.label}`;
  document.querySelectorAll('[data-tab]').forEach(link => {
    if (link.dataset.tab === key) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  });
  app.innerHTML = `<section class="page-heading"><span class="eyebrow">${page.number} / ${h(page.label.toUpperCase())}</span><h1>${h(page.title)}</h1><p>${h(page.description)}</p></section>${key === 'evidence' ? renderEvidence(stage) : renderRequirements(stage, key === 'change')}`;
  document.querySelector('#announcer').textContent = `${page.label}. ${stage.gate.passed} of ${stage.gate.total} checks verified. Human review pending.`;
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-case]');
  if (!button) return;
  selectedCase = button.dataset.case;
  render();
  document.querySelector(`button[data-case="${selectedCase}"]`).focus();
});

try {
  const response = await fetch('/view.json');
  if (!response.ok) throw new Error(`Evidence endpoint returned HTTP ${response.status}.`);
  view = await response.json();
  if (view.product !== 'proofpack' || view.readOnly !== true || !view.stages?.validated) throw new Error('Invalid evidence package.');
  render();
  app.hidden = false;
  loadState.hidden = true;
  window.addEventListener('hashchange', render);
} catch (error) {
  loadState.setAttribute('role', 'alert');
  loadState.textContent = `Evidence could not be loaded. ${error.message} Check the local server logs; acceptance must remain blocked.`;
}
