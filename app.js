const STORAGE_KEY = "tender-quote-mvp-v2";

const statusLabels = {
  draft: "草稿",
  review: "待审核",
  approved: "已审核",
  sent: "已发客户",
  archived: "已归档"
};

const checklistItems = [
  "营业执照",
  "法人授权书",
  "厂家授权/代理证明",
  "技术偏离表",
  "商务偏离表",
  "检测报告/合格证",
  "报价汇总表",
  "保证金/保函",
  "盖章签字",
  "电子投标文件"
];

const money = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const decimal = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const moneyProjectFields = new Set(["budget", "bond"]);
const rateProjectFields = new Set(["taxRate", "targetMargin"]);
const moneyItemFields = new Set(["costUnit", "quoteUnit"]);
const rateItemFields = new Set(["taxRate"]);
const moneyCostFields = new Set(["freight", "installation", "warranty", "service", "finance", "misc"]);
const numericItemFields = new Set(["qty", "costUnit", "quoteUnit", "taxRate", "leadTime", "warranty"]);

let state = loadState();
let currentId = state.currentId || state.projects[0]?.id;
let activeStatus = "all";
let saveTimer;
let lastDeleteAction = null;
let activeAdviceKey = "recommend";
let riskExpanded = false;

const els = {
  projectCount: document.querySelector("#projectCount"),
  statusTabs: document.querySelector("#statusTabs"),
  projectList: document.querySelector("#projectList"),
  projectTitle: document.querySelector("#projectTitle"),
  projectStatusBadge: document.querySelector("#projectStatusBadge"),
  projectForm: document.querySelector("#projectForm"),
  itemsTableBody: document.querySelector("#itemsTable tbody"),
  itemsFileInput: document.querySelector("#itemsFileInput"),
  importStatus: document.querySelector("#importStatus"),
  costForm: document.querySelector("#costForm"),
  checklist: document.querySelector("#checklist"),
  metrics: document.querySelector("#metrics"),
  quoteScenarios: document.querySelector("#quoteScenarios"),
  marginBand: document.querySelector("#marginBand"),
  riskList: document.querySelector("#riskList"),
  savedState: document.querySelector("#savedState"),
  printSheet: document.querySelector("#printSheet"),
  undoBtn: document.querySelector("#undoBtn")
};

document.querySelector("#newProjectBtn").addEventListener("click", () => {
  const project = createProject();
  state.projects.unshift(project);
  currentId = project.id;
  activeStatus = "all";
  persist();
  render();
});

document.querySelector("#duplicateBtn").addEventListener("click", () => {
  const current = getCurrentProject();
  if (!current) return;
  const copy = {
    ...structuredClone(current),
    id: uid(),
    name: `${current.name} - 复盘版`,
    status: "draft"
  };
  state.projects.unshift(copy);
  currentId = copy.id;
  persist();
  render();
});

document.querySelector("#addItemBtn").addEventListener("click", () => {
  const current = getCurrentProject();
  if (!current) return;
  current.items.push(createItem());
  updateProject(current);
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  persist("manual");
});

document.querySelector("#undoBtn").addEventListener("click", undoLastDelete);
document.querySelector("#deleteProjectBtn").addEventListener("click", deleteCurrentProject);
document.querySelector("#clearQuoteBtn").addEventListener("click", clearCurrentQuote);
document.querySelector("#exportBtn").addEventListener("click", exportCurrentCsv);
document.querySelector("#importItemsBtn").addEventListener("click", () => {
  els.itemsFileInput.click();
});
document.querySelector("#templateBtn").addEventListener("click", downloadImportTemplate);
document.querySelector("#customerQuoteBtn").addEventListener("click", () => exportQuoteSheet("customer"));
document.querySelector("#internalQuoteBtn").addEventListener("click", () => exportQuoteSheet("internal"));

els.statusTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-status]");
  if (!tab) return;
  activeStatus = tab.dataset.status;
  renderProjectList();
  renderStatusTabs();
});

els.projectList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-project-id]");
  if (!card) return;
  currentId = card.dataset.projectId;
  persist();
  render();
});

els.projectForm.addEventListener("input", handleProjectInput);
els.projectForm.addEventListener("change", handleProjectInput);
els.projectForm.addEventListener("focusout", handleFormatBlur);
els.costForm.addEventListener("input", handleCostInput);
els.costForm.addEventListener("focusout", handleFormatBlur);
els.checklist.addEventListener("change", handleChecklistInput);
els.itemsTableBody.addEventListener("input", handleItemInput);
els.itemsTableBody.addEventListener("focusout", handleFormatBlur);
els.itemsTableBody.addEventListener("click", handleItemClick);
els.itemsFileInput.addEventListener("change", handleItemsFile);
els.quoteScenarios.addEventListener("click", handleScenarioClick);
els.riskList.addEventListener("click", handleRiskToggle);

render();
persist();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects) && parsed.projects.length) return normalizeState(parsed);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return normalizeState({
    currentId: null,
    projects: seedProjects()
  });
}

function persist(mode = "auto") {
  try {
    state.currentId = currentId;
    state.lastSavedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const savedText = mode === "manual"
      ? `保存成功，已保存到 localStorage 于 ${formatClockTime(state.lastSavedAt)}`
      : `已自动保存于 ${formatClockTime(state.lastSavedAt)}（localStorage）`;
    setSaved(savedText, "success");
    return true;
  } catch {
    setSaved("保存失败，请重试", "error");
    return false;
  }
}

function scheduleSave() {
  setSaved("有未保存修改", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist("auto"), 500);
}

function setSaved(text, type = "") {
  els.savedState.textContent = text;
  els.savedState.className = `saved-state ${type}`.trim();
}

function render() {
  if (!getCurrentProject() && state.projects.length) currentId = state.projects[0].id;
  renderStatusTabs();
  renderProjectList();
  renderEditor();
  renderItems();
  renderCosts();
  renderChecklist();
  renderSummary();
  renderPrintSheet();
}

function renderStatusTabs() {
  const tabs = [{ key: "all", label: "全部" }, ...Object.entries(statusLabels).map(([key, label]) => ({ key, label }))];
  els.statusTabs.innerHTML = tabs
    .map((tab) => {
      const count = tab.key === "all"
        ? state.projects.length
        : state.projects.filter((project) => project.status === tab.key).length;
      return `<button class="status-tab ${activeStatus === tab.key ? "active" : ""}" type="button" data-status="${tab.key}"><span>${tab.label}</span><strong>${count}</strong></button>`;
    })
    .join("");
}

function renderProjectList() {
  const filtered = activeStatus === "all"
    ? state.projects
    : state.projects.filter((project) => project.status === activeStatus);
  els.projectCount.textContent = `${state.projects.length} 个`;

  if (!filtered.length) {
    els.projectList.innerHTML = `<div class="empty-state">当前状态没有项目</div>`;
    return;
  }

  els.projectList.innerHTML = filtered
    .map((project) => {
      const calc = calculate(project);
      const deadline = project.deadline ? `开标 ${project.deadline}` : "未填开标时间";
      return `
        <button class="project-card ${project.id === currentId ? "active" : ""}" type="button" data-project-id="${project.id}">
          <div class="project-card-head">
            <h3>${escapeHtml(project.name || "未命名项目")}</h3>
            <span class="pill ${project.status}">${statusLabels[project.status] || "待定"}</span>
          </div>
          <p>${escapeHtml(project.client || "未填客户")} · ${deadline}</p>
          <p>含税 ${money.format(calc.totalQuote)} · 毛利 ${formatPercent(calc.margin)}</p>
        </button>
      `;
    })
    .join("");
}

function renderCurrentStatusBadge(project) {
  if (!els.projectStatusBadge || !project) return;
  els.projectStatusBadge.textContent = statusLabels[project.status] || "待定";
  els.projectStatusBadge.className = `pill ${project.status || "draft"}`;
}

function renderEditor() {
  const project = getCurrentProject();
  if (!project) return;
  els.projectTitle.textContent = project.name || "未命名项目";
  renderCurrentStatusBadge(project);
  els.projectForm.innerHTML = `
    ${field("项目名称", "name", "text", project.name, "span-2")}
    ${field("客户/招标单位", "client", "text", project.client, "span-2")}
    ${field("报价单位", "company", "text", project.company, "span-2")}
    ${field("报价编号", "quoteNo", "text", project.quoteNo, "", "系统可自动生成")}
    ${field("联系人/电话", "contact", "text", project.contact, "", "姓名 + 手机号")}
    ${field("代理机构", "agency", "text", project.agency)}
    ${field("项目预算", "budget", "number", project.budget)}
    ${field("开标日期", "deadline", "date", project.deadline)}
    ${selectField("项目状态", "status", project.status, statusLabels)}
    ${field("保证金/保函", "bond", "number", project.bond)}
    ${field("税率", "taxRate", "number", project.taxRate, "", "13%")}
    ${field("目标毛利率", "targetMargin", "number", project.targetMargin, "", "18%")}
    ${field("交货期(天)", "deliveryDays", "number", project.deliveryDays)}
    ${field("付款方式", "payment", "text", project.payment, "span-2", "例如：30%预付款，60%到货，10%质保金")}
    ${field("质保(月)", "warrantyMonths", "number", project.warrantyMonths)}
    ${field("报价有效期(天)", "validDays", "number", project.validDays)}
    <div class="field span-4">
      <label for="notes">重要条款</label>
      <textarea id="notes" data-project-field="notes">${escapeHtml(project.notes || "")}</textarea>
    </div>
  `;
}

function renderItems() {
  const project = getCurrentProject();
  if (!project) return;
  els.itemsTableBody.innerHTML = project.items
    .map((item) => {
      const row = calculateItem(item);
      return `
      <tr data-item-id="${item.id}">
        <td><input class="wide" data-item-field="name" value="${escapeAttr(item.name)}" /></td>
        <td><input data-item-field="model" value="${escapeAttr(item.model)}" /></td>
        <td><input data-item-field="supplier" value="${escapeAttr(item.supplier)}" /></td>
        <td><input inputmode="decimal" data-item-field="qty" value="${formatPlainNumber(item.qty)}" /></td>
        <td><input data-item-field="unit" value="${escapeAttr(item.unit)}" /></td>
        <td><input inputmode="decimal" data-item-field="costUnit" value="${formatMoneyInput(item.costUnit)}" /></td>
        <td><input inputmode="decimal" data-item-field="quoteUnit" value="${formatMoneyInput(item.quoteUnit)}" /></td>
        <td><input inputmode="decimal" data-item-field="taxRate" value="${formatRateInput(item.taxRate === "" || item.taxRate === undefined || item.taxRate === null ? project.taxRate : item.taxRate)}" /></td>
        <td><span class="row-margin ${row.margin < 0 ? "danger" : row.margin < rateValue(project.targetMargin) ? "warn" : ""}">${formatPercent(row.margin)}</span></td>
        <td><input inputmode="decimal" data-item-field="leadTime" value="${formatPlainNumber(item.leadTime)}" /></td>
        <td><input inputmode="decimal" data-item-field="warranty" value="${formatPlainNumber(item.warranty)}" /></td>
        <td><input class="note" data-item-field="spec" value="${escapeAttr(item.spec)}" /></td>
        <td class="item-actions">
          <button class="icon-button row-delete" type="button" data-delete-item="${item.id}" aria-label="删除设备" title="删除设备">
            <svg><use href="#i-trash"></use></svg>
          </button>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderCosts() {
  const project = getCurrentProject();
  if (!project) return;
  const costs = project.costs;
  els.costForm.innerHTML = `
    ${costField("运费成本", "freight", costs.freight)}
    ${costField("安装调试", "installation", costs.installation)}
    ${costField("质保预留", "warranty", costs.warranty)}
    ${costField("中标服务费", "service", costs.service)}
    ${costField("垫资成本", "finance", costs.finance)}
    ${costField("其他成本", "misc", costs.misc)}
  `;
}

function renderChecklist() {
  const project = getCurrentProject();
  if (!project) return;
  els.checklist.innerHTML = checklistItems
    .map((item) => `
      <label class="check-item">
        <input type="checkbox" data-check="${escapeAttr(item)}" ${project.checklist[item] ? "checked" : ""} />
        <span>${item}</span>
      </label>
    `)
    .join("");
}

function renderSummary() {
  const project = getCurrentProject();
  if (!project) return;
  const calc = calculate(project);
  const risks = getRisks(project, calc);
  els.metrics.innerHTML = `
    ${metric("总成本", money.format(calc.totalCost), `公司预计要花的钱：设备 ${money.format(calc.itemCost)} + 费用 ${money.format(calc.extraCost)}`)}
    ${metric("总报价", money.format(calc.salesExTax), "不含税，来自左侧分项报价")}
    ${metric("毛利额", money.format(calc.grossProfit), "报价减去成本后剩下的钱")}
    ${metric("毛利率", formatPercent(calc.margin), `建议不低于 ${formatPercent(calc.targetMargin)}`)}
    ${metric("给客户的含税价", money.format(calc.totalQuote), `包含税额 ${money.format(calc.taxAmount)}`)}
    ${metric("亏损警戒线", money.format(calc.breakEvenTotalQuote), "报价低于这个数，公司就可能亏钱")}
  `;
  renderQuoteScenarios(project, calc);

  const marginScore = clamp(calc.margin * 100, 0, 45);
  const fillClass = calc.margin < 0 ? "danger" : calc.margin < calc.targetMargin ? "warn" : "";
  els.marginBand.innerHTML = `
    <div class="band-track"><div class="band-fill ${fillClass}" style="width:${Math.max(3, (marginScore / 45) * 100)}%"></div></div>
    <div class="band-text"><span>当前毛利率 ${formatPercent(calc.margin)}</span><span>风险 ${risks.length} 项</span></div>
  `;

  renderRiskList(risks);
}

function renderQuoteScenarios(project, calc) {
  const scenarios = getQuoteScenarios(project, calc);
  els.quoteScenarios.innerHTML = `
    <div class="scenario-head">
      <div>
        <span>系统只做参考</span>
        <strong>报价建议</strong>
      </div>
      <small>最终报价以人工审核为准</small>
    </div>
    <div class="scenario-list">
      ${scenarios.map((scenario) => `
        <div class="scenario-card ${scenario.level} ${activeAdviceKey === scenario.key ? "open" : ""}">
          <div class="scenario-card-title">
            <strong>${scenario.name}</strong>
            <span>${scenario.badge}</span>
          </div>
          <div class="scenario-price">${money.format(scenario.totalQuote)}</div>
          <div class="scenario-meta">
            <span>不含税 ${money.format(scenario.salesExTax)}</span>
            <span>毛利 ${money.format(scenario.grossProfit)}</span>
            <span>毛利率 ${formatPercent(scenario.margin)}</span>
          </div>
          <div class="scenario-action-row">
            <small>${scenario.summary}</small>
            <button class="button ghost scenario-action" type="button" data-scenario-key="${scenario.key}" aria-expanded="${activeAdviceKey === scenario.key}">
              查看建议
            </button>
          </div>
          ${activeAdviceKey === scenario.key ? `
            <div class="scenario-detail">
              <strong>建议说明</strong>
              <p>${scenario.risk}</p>
              <p>仅供内部测算，报价前仍需人工复核成本、供货、付款和招标评分规则。</p>
            </div>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderRiskList(risks) {
  if (!risks.length) {
    els.riskList.innerHTML = `<div class="risk-item low">当前项目没有明显报价风险</div>`;
    return;
  }
  const hasHighRisk = risks.some((risk) => risk.level === "high");
  els.riskList.innerHTML = `
    <div class="risk-summary ${hasHighRisk ? "high" : ""}">
      <span>当前有 ${risks.length} 项风险${hasHighRisk ? "，含高风险项" : ""}</span>
      <button class="button ghost risk-toggle" type="button" data-risk-toggle="${riskExpanded ? "close" : "open"}">
        ${riskExpanded ? "收起" : "展开查看"}
      </button>
    </div>
    ${riskExpanded ? `<div class="risk-list">${risks
      .map((risk) => `<div class="risk-item ${risk.level}">${risk.text}</div>`)
      .join("")}</div>` : ""}
  `;
}

function renderPrintSheet(mode = "customer") {
  const project = getCurrentProject();
  if (!project) return;
  const calc = calculate(project);
  const isInternal = mode === "internal";
  const risks = getRisks(project, calc);
  els.printSheet.innerHTML = `
    <div class="print-title">
      <div>
        <p class="print-company">${escapeHtml(project.company || "报价单位")}</p>
        <h1>${isInternal ? "公司内部审核单" : "客户报价单"}</h1>
        <p class="print-version">${isInternal ? "内部使用：含完整成本、利润、供应商信息" : "对外发送版本"}</p>
        <p>报价编号：${escapeHtml(project.quoteNo || "-")}</p>
        <p>项目名称：${escapeHtml(project.name || "")}</p>
      </div>
      <div>
        <p>报价日期：${new Date().toLocaleDateString("zh-CN")}</p>
        <p>联系人：${escapeHtml(project.contact || "-")}</p>
        <p>报价有效期：${Number(project.validDays || 0)} 天</p>
      </div>
    </div>
    <div class="print-meta">
      <p>客户/招标单位：${escapeHtml(project.client || "-")}</p>
      <p>代理机构：${escapeHtml(project.agency || "-")}</p>
      <p>开标日期：${project.deadline || "-"}</p>
      <p>交货期：${Number(project.deliveryDays || 0)} 天</p>
      <p>质保期：${Number(project.warrantyMonths || 0)} 个月</p>
      <p>付款方式：${escapeHtml(project.payment || "-")}</p>
      <p>税率：${formatPercent(calc.taxRate)}</p>
      <p>项目预算：${money.format(Number(project.budget || 0))}</p>
    </div>
    <table class="print-table ${isInternal ? "internal" : "customer"}">
      <thead>
        ${isInternal ? internalPrintHeader() : customerPrintHeader()}
      </thead>
      <tbody>
        ${project.items
          .map((item, index) => {
            const row = calculateItem(item, project.taxRate);
            return isInternal
              ? internalPrintRow(item, row, index)
              : customerPrintRow(item, row, index);
          })
          .join("")}
      </tbody>
    </table>
    <div class="print-total">
      ${isInternal
        ? `
          <span>总成本：${money.format(calc.totalCost)}</span>
          <span>不含税报价：${money.format(calc.salesExTax)}</span>
          <span>毛利额：${money.format(calc.grossProfit)}</span>
          <span>毛利率：${formatPercent(calc.margin)}</span>
          <strong>含税总价：${money.format(calc.totalQuote)}</strong>
          <span>亏损警戒线：${money.format(calc.breakEvenTotalQuote)} 含税</span>
        `
        : `
          <span>不含税合计：${money.format(calc.salesExTax)}</span>
          <span>税率/税额：${formatPercent(calc.taxRate)} / ${money.format(calc.taxAmount)}</span>
          <strong>含税投标总价：${money.format(calc.totalQuote)}</strong>
          <span>大写：${formatChineseMoney(calc.totalQuote)}</span>
        `}
    </div>
    ${isInternal ? renderInternalPrintRisks(risks) : ""}
    <div class="print-terms">
      <p>付款方式：${escapeHtml(project.payment || "-")}</p>
      <p>交货期：${Number(project.deliveryDays || 0)} 天</p>
      <p>质保期：${Number(project.warrantyMonths || 0)} 个月</p>
      <p>报价有效期：${Number(project.validDays || 0)} 天</p>
    </div>
    <p class="print-note">备注：${escapeHtml(isInternal ? (project.notes || "本报价以招标文件、技术响应及双方确认范围为准。") : "本报价以招标文件、技术响应及双方确认范围为准。")}</p>
    <div class="print-sign">
      <span>报价单位：${escapeHtml(project.company || "________________")}</span>
      <span>授权代表：________________</span>
      <span>公司盖章：________________</span>
    </div>
  `;
}

function exportQuoteSheet(mode) {
  renderPrintSheet(mode);
  const project = getCurrentProject();
  const suffix = mode === "internal" ? "公司内部审核单" : "客户报价单";
  const fileName = `${sanitizeFileName(project?.name || "招标报价")}-${suffix}.html`;
  const html = buildQuoteSheetHtml(els.printSheet.innerHTML, suffix);
  downloadText(html, fileName, "text/html;charset=utf-8");
  setSaved(`${suffix}已导出`);
}

function buildQuoteSheetHtml(content, title) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; padding: 24px; color: #111827; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
      .print-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 18px; }
      .print-title h1 { margin: 0; font-size: 24px; }
      .print-company { font-weight: 800; }
      .print-version { font-weight: 700; color: #4b5563; }
      .print-title p, .print-meta p, .print-note, .print-terms p, .print-risk p { margin: 4px 0; font-size: 12px; }
      .print-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
      .print-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .print-table.internal { font-size: 9.5px; }
      .print-table th, .print-table td { border: 1px solid #111827; padding: 7px; text-align: left; vertical-align: top; }
      .print-table th { background: #f3f4f6; }
      .print-total { margin-top: 16px; display: grid; justify-content: end; gap: 5px; font-size: 13px; }
      .print-total strong { font-size: 18px; }
      .print-risk { margin-top: 14px; border: 1px solid #b42318; padding: 8px 10px; color: #7f1d1d; }
      .print-risk strong { display: block; margin-bottom: 4px; }
      .print-terms { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; border: 1px solid #111827; padding: 8px; }
      .print-sign { margin-top: 42px; display: flex; justify-content: space-between; gap: 32px; font-size: 13px; }
      @media print { @page { size: A4 landscape; margin: 12mm; } body { padding: 0; } }
    </style>
  </head>
  <body>${content}</body>
</html>`;
}

function customerPrintHeader() {
  return `
    <tr>
      <th>序号</th>
      <th>设备/服务</th>
      <th>型号</th>
      <th>数量</th>
      <th>单位</th>
      <th>不含税单价</th>
      <th>不含税小计</th>
      <th>含税小计</th>
      <th>交期</th>
      <th>质保</th>
      <th>参数/响应</th>
    </tr>
  `;
}

function internalPrintHeader() {
  return `
    <tr>
      <th>序号</th>
      <th>设备/服务</th>
      <th>型号</th>
      <th>供应商</th>
      <th>数量</th>
      <th>单位</th>
      <th>成本单价</th>
      <th>成本小计</th>
      <th>报价单价</th>
      <th>报价小计</th>
      <th>税率</th>
      <th>含税小计</th>
      <th>毛利额</th>
      <th>毛利率</th>
      <th>交期</th>
      <th>质保</th>
      <th>参数/响应</th>
    </tr>
  `;
}

function customerPrintRow(item, row, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${Number(item.qty || 0)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${money.format(Number(item.quoteUnit || 0))}</td>
      <td>${money.format(row.sales)}</td>
      <td>${money.format(row.totalQuote)}</td>
      <td>${numberValue(item.leadTime) ? `${numberValue(item.leadTime)} 天` : "-"}</td>
      <td>${numberValue(item.warranty) ? `${numberValue(item.warranty)} 月` : "-"}</td>
      <td>${escapeHtml(item.spec)}</td>
    </tr>
  `;
}

function internalPrintRow(item, row, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${escapeHtml(item.supplier || "-")}</td>
      <td>${Number(item.qty || 0)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${money.format(Number(item.costUnit || 0))}</td>
      <td>${money.format(row.cost)}</td>
      <td>${money.format(Number(item.quoteUnit || 0))}</td>
      <td>${money.format(row.sales)}</td>
      <td>${formatPercent(row.taxRate)}</td>
      <td>${money.format(row.totalQuote)}</td>
      <td>${money.format(row.grossProfit)}</td>
      <td>${formatPercent(row.margin)}</td>
      <td>${numberValue(item.leadTime) ? `${numberValue(item.leadTime)} 天` : "-"}</td>
      <td>${numberValue(item.warranty) ? `${numberValue(item.warranty)} 月` : "-"}</td>
      <td>${escapeHtml(item.spec)}</td>
    </tr>
  `;
}

function renderInternalPrintRisks(risks) {
  if (!risks.length) return `<div class="print-risk"><strong>内部风险提醒：</strong><p>当前报价未识别出明显风险。</p></div>`;
  return `
    <div class="print-risk">
      <strong>内部风险提醒</strong>
      ${risks.map((risk) => `<p>${escapeHtml(risk.text)}</p>`).join("")}
    </div>
  `;
}

function handleProjectInput(event) {
  const fieldName = event.target.dataset.projectField;
  if (!fieldName) return;
  const project = getCurrentProject();
  project[fieldName] = parseFieldValue(fieldName, event.target.value);
  if (fieldName === "status") renderCurrentStatusBadge(project);
  updateProject(project, true);
  if (fieldName === "targetMargin" || fieldName === "taxRate") renderItems();
}

function handleCostInput(event) {
  const fieldName = event.target.dataset.costField;
  if (!fieldName) return;
  const project = getCurrentProject();
  project.costs[fieldName] = numberValue(event.target.value);
  updateProject(project, true);
}

function handleFormatBlur(event) {
  const projectField = event.target.dataset.projectField;
  const costField = event.target.dataset.costField;
  const itemField = event.target.dataset.itemField;
  if (projectField) {
    event.target.value = formatProjectInput(projectField, event.target.value);
  } else if (costField) {
    event.target.value = moneyCostFields.has(costField) ? formatMoneyInput(event.target.value) : formatPlainNumber(event.target.value);
  } else if (itemField) {
    event.target.value = formatItemInput(itemField, event.target.value);
  }
}

function handleChecklistInput(event) {
  const item = event.target.dataset.check;
  if (!item) return;
  const project = getCurrentProject();
  project.checklist[item] = event.target.checked;
  updateProject(project, true);
}

function handleItemInput(event) {
  const fieldName = event.target.dataset.itemField;
  if (!fieldName) return;
  const row = event.target.closest("[data-item-id]");
  const project = getCurrentProject();
  const item = project.items.find((entry) => entry.id === row.dataset.itemId);
  if (!item) return;
  item[fieldName] = numericItemFields.has(fieldName)
    ? parseItemNumber(fieldName, event.target.value)
    : event.target.value;
  updateItemRowMetrics(row, item, project);
  updateProject(project, true);
}

function updateItemRowMetrics(row, item, project) {
  const metric = row.querySelector(".row-margin");
  if (!metric) return;
  const itemCalc = calculateItem(item);
  metric.textContent = formatPercent(itemCalc.margin);
  metric.className = `row-margin ${itemCalc.margin < 0 ? "danger" : itemCalc.margin < rateValue(project.targetMargin) ? "warn" : ""}`.trim();
}

function handleItemClick(event) {
  const id = event.target.closest("[data-delete-item]")?.dataset.deleteItem;
  if (!id) return;
  const project = getCurrentProject();
  const item = project.items.find((entry) => entry.id === id);
  if (!item) return;
  if (!window.confirm(`确定删除这行设备吗？\n\n${item.name || "未命名设备"}\n删除后可以点“撤销删除”恢复。`)) {
    return;
  }
  rememberDelete({
    type: "items",
    label: "已删除 1 行设备",
    projectId: project.id,
    beforeItems: structuredClone(project.items),
    beforeCosts: structuredClone(project.costs)
  });
  project.items = project.items.length === 1
    ? [createItem()]
    : project.items.filter((entry) => entry.id !== id);
  updateProject(project);
}

function clearCurrentQuote() {
  const project = getCurrentProject();
  if (!project) return;
  const hasQuoteData = project.items.some((item) => item.name || item.model || numberValue(item.costUnit) || numberValue(item.quoteUnit))
    || Object.values(project.costs).some((value) => numberValue(value) > 0);
  if (!hasQuoteData) {
    setImportStatus("当前报价已经是空的", "success");
    return;
  }
  if (!window.confirm("确定清空当前报价吗？\n\n会清空设备明细和内部费用，项目基本信息会保留。清空后可以点“撤销删除”恢复。")) {
    return;
  }
  rememberDelete({
    type: "items",
    label: "已清空当前报价",
    projectId: project.id,
    beforeItems: structuredClone(project.items),
    beforeCosts: structuredClone(project.costs)
  });
  project.items = [createItem()];
  project.costs = {
    freight: 0,
    installation: 0,
    warranty: 0,
    service: 0,
    finance: 0,
    misc: 0
  };
  updateProject(project);
  setImportStatus("当前报价已清空，可撤销", "success");
}

function deleteCurrentProject() {
  const project = getCurrentProject();
  if (!project) return;
  if (state.projects.length <= 1) {
    window.alert("至少需要保留一个报价记录。");
    return;
  }
  if (!window.confirm(`确定删除这条历史报价记录吗？\n\n${project.name || "未命名项目"}\n删除后可以点“撤销删除”恢复。`)) {
    return;
  }
  const index = state.projects.findIndex((entry) => entry.id === project.id);
  rememberDelete({
    type: "project",
    label: "已删除 1 条历史报价记录",
    project: structuredClone(project),
    index
  });
  state.projects.splice(index, 1);
  currentId = state.projects[Math.max(0, index - 1)]?.id || state.projects[0]?.id;
  persist("auto");
  render();
}

function rememberDelete(action) {
  lastDeleteAction = action;
  renderUndoState();
  setSaved(`${action.label}，可撤销`, "pending");
}

function undoLastDelete() {
  if (!lastDeleteAction) return;
  if (lastDeleteAction.type === "project") {
    const insertAt = Math.min(lastDeleteAction.index, state.projects.length);
    state.projects.splice(insertAt, 0, structuredClone(lastDeleteAction.project));
    currentId = lastDeleteAction.project.id;
  }
  if (lastDeleteAction.type === "items") {
    const project = state.projects.find((entry) => entry.id === lastDeleteAction.projectId);
    if (!project) return;
    project.items = structuredClone(lastDeleteAction.beforeItems);
    project.costs = structuredClone(lastDeleteAction.beforeCosts);
    currentId = project.id;
  }
  lastDeleteAction = null;
  renderUndoState();
  persist("manual");
  render();
  setImportStatus("已撤销最近一次删除", "success");
}

function renderUndoState() {
  if (!els.undoBtn) return;
  els.undoBtn.disabled = !lastDeleteAction;
}

function handleScenarioClick(event) {
  const button = event.target.closest("[data-scenario-key]");
  if (!button) return;
  const project = getCurrentProject();
  if (!project) return;
  activeAdviceKey = button.dataset.scenarioKey;
  renderQuoteScenarios(project, calculate(project));
}

function handleRiskToggle(event) {
  const button = event.target.closest("[data-risk-toggle]");
  if (!button) return;
  riskExpanded = button.dataset.riskToggle === "open";
  const project = getCurrentProject();
  if (!project) return;
  renderRiskList(getRisks(project, calculate(project)));
}

function updateProject(project, lightRender = false) {
  state.projects = state.projects.map((entry) => entry.id === project.id ? project : entry);
  scheduleSave();
  if (lightRender) {
    els.projectTitle.textContent = project.name || "未命名项目";
    renderCurrentStatusBadge(project);
    renderProjectList();
    renderSummary();
    renderPrintSheet();
    renderStatusTabs();
  } else {
    render();
  }
}

function calculateItem(item, fallbackTaxRate = 0) {
  const qty = numberValue(item.qty);
  const cost = qty * numberValue(item.costUnit);
  const sales = qty * numberValue(item.quoteUnit);
  const taxRate = getItemTaxRate(item, fallbackTaxRate);
  const taxAmount = sales * taxRate;
  const totalQuote = sales + taxAmount;
  const grossProfit = sales - cost;
  const margin = sales > 0 ? grossProfit / sales : 0;
  return { qty, cost, sales, taxRate, taxAmount, totalQuote, grossProfit, margin };
}

function calculate(project) {
  const itemRows = project.items.map((item) => calculateItem(item, project.taxRate));
  const itemCost = itemRows.reduce((sum, row) => sum + row.cost, 0);
  const salesExTax = itemRows.reduce((sum, row) => sum + row.sales, 0);
  const extraCost = Object.values(project.costs).reduce((sum, value) => sum + numberValue(value), 0);
  const totalCost = itemCost + extraCost;
  const taxAmount = itemRows.reduce((sum, row) => sum + row.taxAmount, 0);
  const taxRate = salesExTax > 0 ? taxAmount / salesExTax : rateValue(project.taxRate);
  const targetMargin = rateValue(project.targetMargin);
  const totalQuote = salesExTax + taxAmount;
  const grossProfit = salesExTax - totalCost;
  const margin = salesExTax > 0 ? grossProfit / salesExTax : 0;
  const breakEvenSalesExTax = totalCost;
  const breakEvenTotalQuote = breakEvenSalesExTax * (1 + taxRate);
  const minSalesExTax = targetMargin >= 1 ? totalCost : totalCost / Math.max(0.01, 1 - targetMargin);
  const minTotalQuote = minSalesExTax * (1 + taxRate);
  return {
    itemCost,
    salesExTax,
    extraCost,
    totalCost,
    taxRate,
    targetMargin,
    taxAmount,
    totalQuote,
    grossProfit,
    margin,
    breakEvenSalesExTax,
    breakEvenTotalQuote,
    minSalesExTax,
    minTotalQuote
  };
}

function getItemTaxRate(item, fallbackTaxRate = 0) {
  return item.taxRate === "" || item.taxRate === undefined || item.taxRate === null
    ? rateValue(fallbackTaxRate)
    : rateValue(item.taxRate);
}

function getQuoteScenarios(project, calc) {
  const taxRate = rateValue(calc.taxRate);
  const budget = numberValue(project.budget);
  const targetMargin = clamp(rateValue(project.targetMargin), 0, 0.65);
  const competitiveMargin = clamp(Math.min(targetMargin * 0.55, 0.08), 0.03, 0.1);
  const steadyMargin = clamp(targetMargin + 0.05, targetMargin, 0.36);
  const scenarios = [
    makeScenario("break-even", "保本参考", "守底线", 0, "high", "只覆盖内部总成本，低于这一档就是亏损；通常不建议作为正式报价，只用于判断底线。", "看亏损边界", calc, taxRate, budget),
    makeScenario("competitive", "低价参考", "价格优先", competitiveMargin, "warn", "价格更有竞争力，但利润薄，安装、质保、回款延迟或漏项都会明显放大风险。", "看竞争低价", calc, taxRate, budget),
    makeScenario("recommend", "推荐报价", "推荐", targetMargin, "good", "按目标毛利率倒推，适合作为正常投标主报价的参考，兼顾利润和中标可能性。", "看常规建议", calc, taxRate, budget),
    makeScenario("steady", "稳健报价", "稳一点", steadyMargin, "safe", "利润和售后缓冲更足，但如果招标方价格权重较高，中标风险会增加。", "看利润缓冲", calc, taxRate, budget)
  ];
  return scenarios.map((scenario) => ({
    ...scenario,
    risk: scenario.budgetWarning ? `${scenario.risk} ${scenario.budgetWarning}` : scenario.risk
  }));
}

function makeScenario(key, name, badge, margin, level, risk, summary, calc, taxRate, budget) {
  const salesExTax = calc.totalCost / Math.max(0.01, 1 - margin);
  const taxAmount = salesExTax * taxRate;
  const totalQuote = salesExTax + taxAmount;
  const grossProfit = salesExTax - calc.totalCost;
  const budgetWarning = budget > 0 && totalQuote > budget
    ? `该档超过预算 ${money.format(totalQuote - budget)}。`
    : "";
  return {
    key,
    name,
    badge,
    level,
    risk,
    summary,
    margin,
    salesExTax,
    taxAmount,
    totalQuote,
    grossProfit,
    budgetWarning
  };
}

function getRisks(project, calc) {
  const risks = [];
  const budget = numberValue(project.budget);
  const lowMarginLine = Math.max(0.08, calc.targetMargin);
  if (calc.totalQuote > budget && budget > 0) {
    risks.push({ level: "high", text: `含税总价超过预算 ${money.format(calc.totalQuote - budget)}，容易被价格线卡住。` });
  }
  if (calc.totalCost > calc.salesExTax) {
    risks.push({ level: "high", text: `成本高于报价 ${money.format(calc.totalCost - calc.salesExTax)}，当前报价会产生亏损。` });
  }
  if (project.items.some((item) => numberValue(item.costUnit) > numberValue(item.quoteUnit) && numberValue(item.quoteUnit) > 0)) {
    risks.push({ level: "high", text: "存在设备成本单价高于报价单价，请复核供应商底价和报价策略。" });
  }
  if (calc.margin < 0) {
    risks.push({ level: "high", text: "毛利率为负，建议立即复核成本、费用和报价单价。" });
  } else if (calc.margin < lowMarginLine) {
    risks.push({ level: "medium", text: `毛利率过低，当前 ${formatPercent(calc.margin)}，目标/安全线为 ${formatPercent(lowMarginLine)}。` });
  }
  if (!project.deadline) {
    risks.push({ level: "medium", text: "未填写开标日期，容易漏掉递交时间。" });
  } else {
    const days = daysUntil(project.deadline);
    if (days >= 0 && days <= 3) {
      risks.push({ level: "high", text: `距离开标只剩 ${days} 天，资料和盖章需要优先确认。` });
    }
  }
  if (!project.payment) risks.push({ level: "medium", text: "未填写付款方式，垫资成本可能被低估。" });
  if (numberValue(project.deliveryDays) <= 0 || project.items.some((item) => numberValue(item.leadTime) <= 0)) {
    risks.push({ level: "medium", text: "交期缺失：项目交货期或部分设备交期未填写，客户交付承诺不完整。" });
  }
  if (numberValue(project.warrantyMonths) <= 0 || project.items.some((item) => numberValue(item.warranty) <= 0)) {
    risks.push({ level: "medium", text: "质保缺失：项目质保期或部分设备质保未填写，售后责任边界不清晰。" });
  }
  if (project.items.some((item) => numberValue(item.qty) <= 0 || numberValue(item.qty) > 10000)) {
    risks.push({ level: "high", text: "数量异常：存在数量为 0、负数或异常大的分项，请检查导入文件和单位。" });
  }
  if (project.items.some((item) => !item.name || !item.model || !item.spec)) {
    risks.push({ level: "medium", text: "设备名称、型号或技术响应未填完整，可能影响技术评分。" });
  }
  if (project.items.some((item) => !item.supplier)) {
    risks.push({ level: "medium", text: "供应商缺失：部分设备未填写供应商，后续比价、供货和售后追踪会受影响。" });
  }
  if (project.items.some((item) => numberValue(item.costUnit) <= 0 || numberValue(item.quoteUnit) <= 0)) {
    risks.push({ level: "medium", text: "部分设备成本或报价单价为 0，建议导入后复核单价。" });
  }
  const missing = checklistItems.filter((item) => !project.checklist[item]);
  if (missing.length) {
    risks.push({ level: "medium", text: `还有 ${missing.length} 项投标资料未确认：${missing.slice(0, 3).join("、")}${missing.length > 3 ? "等" : ""}。` });
  }
  return risks;
}

function exportCurrentCsv() {
  const project = getCurrentProject();
  if (!project) return;
  const calc = calculate(project);
  const rows = [
    ["报价编号", project.quoteNo],
    ["报价单位", project.company],
    ["联系人/电话", project.contact],
    ["项目名称", project.name],
    ["客户/招标单位", project.client],
    ["开标日期", project.deadline],
    ["项目状态", statusLabels[project.status] || "待定"],
    ["含税总价", formatMoneyInput(calc.totalQuote)],
    ["预计毛利", formatMoneyInput(calc.grossProfit)],
    ["毛利率", formatPercent(calc.margin)],
    [],
    ["设备/服务名称", "型号", "供应商", "数量", "单位", "成本单价", "报价单价", "税率", "不含税小计", "含税小计", "行毛利率", "交期(天)", "质保(月)", "参数/备注"],
    ...project.items.map((item) => {
      const row = calculateItem(item, project.taxRate);
      return [
        item.name,
        item.model,
        item.supplier,
        item.qty,
        item.unit,
        formatMoneyInput(item.costUnit),
        formatMoneyInput(item.quoteUnit),
        formatPercent(row.taxRate),
        formatMoneyInput(row.sales),
        formatMoneyInput(row.totalQuote),
        formatPercent(row.margin),
        item.leadTime,
        item.warranty,
        item.spec
      ];
    })
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(project.name || "招标报价")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleItemsFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const project = getCurrentProject();
    if (!project) return;
    const rows = await readImportRows(file);
    const items = rowsToItems(rows, project.taxRate);
    if (!items.length) {
      setImportStatus("未识别到有效设备行", "error");
      return;
    }

    const hasExistingItems = project.items.some((item) => item.name || item.model || numberValue(item.costUnit) || numberValue(item.quoteUnit));
    if (hasExistingItems && !window.confirm(`导入会替换当前 ${project.items.length} 条分项报价，是否继续？`)) {
      return;
    }

    project.items = items;
    updateProject(project);
    setImportStatus(`已导入 ${items.length} 条分项报价，并重新计算汇总`, "success");
  } catch (error) {
    const message = error.message === "XLSX_NOT_AVAILABLE"
      ? "Excel 解析库未加载成功，请使用下载模板生成的 .xls 或另存为 CSV 后导入"
      : "文件读取失败，请检查文件格式";
    setImportStatus(message, "error");
  } finally {
    event.target.value = "";
  }
}

function downloadImportTemplate() {
  const rows = [
    ["设备/服务名称", "型号", "供应商", "数量", "单位", "成本单价", "报价单价", "税率", "交期", "质保", "参数/备注"],
    ["燃气调压计量撬", "RX-500", "示例供应商", 2, "套", "285000.00", "380000.00", "13%", 35, 24, "满足流量、压力、过滤、计量及防爆要求"],
    ["远程监测终端", "RTU-4G", "示例供应商", 2, "套", "18000.00", "32000.00", "13%", 20, 12, "支持压力、温度、流量数据上传"]
  ];
  if (window.XLSX) {
    downloadXlsxTemplate(rows, "分项报价导入模板.xlsx");
  } else {
    downloadExcelTable(rows, "分项报价导入模板.xls");
  }
}

function setImportStatus(text, type = "") {
  els.importStatus.textContent = text;
  els.importStatus.className = `import-status ${type}`.trim();
}

async function readImportRows(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (["xlsx", "xls"].includes(extension) && window.XLSX) {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
      return rows.map((row) => row.map(cleanCell)).filter((row) => row.some(Boolean));
    } catch {
      if (extension === "xlsx") throw new Error("XLSX_NOT_AVAILABLE");
    }
  }
  if (extension === "xlsx") throw new Error("XLSX_NOT_AVAILABLE");
  const text = await file.text();
  return parseImportRows(text);
}

function parseImportRows(text) {
  const cleanText = String(text || "").trim();
  if (/<table[\s>]/i.test(cleanText)) return parseHtmlTable(cleanText);
  return parseDelimitedText(cleanText);
}

function parseHtmlTable(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return [];
  return Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => cleanCell(cell.textContent)))
    .filter((row) => row.some(Boolean));
}

function parseDelimitedText(text) {
  const cleanText = String(text || "").replace(/^\ufeff/, "");
  const delimiter = detectDelimiter(cleanText);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const next = cleanText[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(cleanCell(cell));
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cleanCell(cell));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cleanCell(cell));
    rows.push(row);
  }

  return rows.filter((entry) => entry.some(Boolean));
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function rowsToItems(rows, defaultTaxRate = 0) {
  if (!rows.length) return [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => resolveItemField(cell)));
  const hasHeader = headerIndex >= 0;
  const header = hasHeader ? rows[headerIndex] : [];
  const body = hasHeader ? rows.slice(headerIndex + 1) : rows;
  const mapping = hasHeader ? buildItemColumnMap(header) : fallbackItemColumnMap();

  return body
    .map((row) => rowToItem(row, mapping, defaultTaxRate))
    .filter((item) => item.name || item.model || item.supplier || numberValue(item.costUnit) || numberValue(item.quoteUnit));
}

function buildItemColumnMap(header) {
  return header.reduce((mapping, cell, index) => {
    const fieldName = resolveItemField(cell);
    if (fieldName && mapping[fieldName] === undefined) mapping[fieldName] = index;
    return mapping;
  }, {});
}

function fallbackItemColumnMap() {
  return {
    name: 0,
    model: 1,
    supplier: 2,
    qty: 3,
    unit: 4,
    costUnit: 5,
    quoteUnit: 6,
    taxRate: 7,
    leadTime: 8,
    warranty: 9,
    spec: 10
  };
}

function rowToItem(row, mapping, defaultTaxRate = 0) {
  const value = (fieldName) => mapping[fieldName] === undefined ? "" : row[mapping[fieldName]];
  return normalizeItem({
    id: uid(),
    name: value("name"),
    model: value("model"),
    supplier: value("supplier"),
    qty: numberValue(value("qty")) || 1,
    unit: value("unit") || "台",
    costUnit: numberValue(value("costUnit")),
    quoteUnit: numberValue(value("quoteUnit")),
    taxRate: value("taxRate") ? rateValue(value("taxRate")) : rateValue(defaultTaxRate),
    leadTime: numberValue(value("leadTime")),
    warranty: numberValue(value("warranty")),
    spec: value("spec")
  });
}

function resolveItemField(header) {
  const text = normalizeHeader(header);
  if (!text) return "";
  if (["设备服务", "设备服务名称", "设备名称", "产品名称", "物料名称", "名称", "设备", "项目"].includes(text)) return "name";
  if (["型号", "规格型号", "型号规格", "规格", "规格参数"].includes(text)) return "model";
  if (["供应商", "供货商", "厂家", "品牌", "制造商"].includes(text)) return "supplier";
  if (["数量", "qty", "数目"].includes(text)) return "qty";
  if (["单位", "unit"].includes(text)) return "unit";
  if (text.includes("成本") || text.includes("采购") || text.includes("进货")) return "costUnit";
  if (text.includes("报价") || text.includes("销售") || text === "单价" || text.includes("投标单价")) return "quoteUnit";
  if (text.includes("税率")) return "taxRate";
  if (text.includes("交期") || text.includes("交货期") || text.includes("供货期")) return "leadTime";
  if (text.includes("质保") || text.includes("保修")) return "warranty";
  if (text.includes("参数") || text.includes("响应") || text.includes("备注") || text.includes("说明")) return "spec";
  return "";
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_：:／/\\（）(),，。.-]/g, "")
    .replace(/不含税|含税|元|天|月/g, "");
}

function cleanCell(value) {
  return String(value ?? "").trim();
}

function downloadCsv(rows, fileName) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadText(`\ufeff${csv}`, fileName, "text/csv;charset=utf-8");
}

function downloadExcelTable(rows, fileName) {
  const tableRows = rows
    .map((row, rowIndex) => `<tr>${row
      .map((cell) => rowIndex === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)
      .join("")}</tr>`)
    .join("");
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; font-family: "Microsoft YaHei", Arial, sans-serif; }
      th, td { border: 1px solid #999; padding: 6px 8px; mso-number-format:"\\@"; }
      th { background: #eaf5f2; font-weight: 700; }
    </style>
  </head>
  <body><table>${tableRows}</table></body>
</html>`;
  downloadText(`\ufeff${html}`, fileName, "application/vnd.ms-excel;charset=utf-8");
}

function downloadXlsxTemplate(rows, fileName) {
  const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 8 },
    { wch: 8 },
    { wch: 34 }
  ];
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "报价明细");
  window.XLSX.writeFile(workbook, fileName);
}

function downloadText(text, fileName, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function field(label, name, type, value, className = "", placeholder = "") {
  const inputType = type === "number" ? "text" : type;
  const inputMode = type === "number" ? "decimal" : "";
  const displayValue = type === "number" ? formatProjectInput(name, value) : value ?? "";
  return `
    <div class="field ${className}">
      <label for="${name}">${label}</label>
      <input id="${name}" type="${inputType}" inputmode="${inputMode}" data-project-field="${name}" value="${escapeAttr(displayValue)}" placeholder="${placeholder}" />
    </div>
  `;
}

function selectField(label, name, value, options) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <select id="${name}" data-project-field="${name}">
        ${Object.entries(options)
          .map(([key, text]) => `<option value="${key}" ${value === key ? "selected" : ""}>${text}</option>`)
          .join("")}
      </select>
    </div>
  `;
}

function costField(label, name, value) {
  return `
    <div class="field">
      <label for="cost-${name}">${label}</label>
      <input id="cost-${name}" type="text" inputmode="decimal" data-cost-field="${name}" value="${formatMoneyInput(value)}" />
    </div>
  `;
}

function metric(label, value, subtext) {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${subtext}</small>
    </div>
  `;
}

function normalizeState(nextState) {
  const projects = nextState.projects.map(normalizeProject);
  const firstProject = projects[0];
  return {
    ...nextState,
    projects,
    currentId: projects.some((project) => project.id === nextState.currentId) ? nextState.currentId : firstProject?.id
  };
}

function normalizeProject(project) {
  const checklist = Object.fromEntries(checklistItems.map((item) => [item, Boolean(project.checklist?.[item])]));
  return {
    ...project,
    id: project.id || uid(),
    status: normalizeStatus(project.status),
    quoteNo: project.quoteNo || makeQuoteNo(),
    company: project.company || "",
    contact: project.contact || "",
    taxRate: rateValue(project.taxRate ?? 0.13),
    targetMargin: rateValue(project.targetMargin ?? 0.18),
    costs: {
      freight: 0,
      installation: 0,
      warranty: 0,
      service: 0,
      finance: 0,
      misc: 0,
      ...(project.costs || {})
    },
    checklist,
    items: Array.isArray(project.items) && project.items.length
      ? project.items.map(normalizeItem)
      : [createItem()]
  };
}

function normalizeStatus(status) {
  const legacyStatus = {
    quoted: "approved",
    submitted: "sent",
    won: "archived",
    lost: "archived"
  };
  const nextStatus = legacyStatus[status] || status || "draft";
  return statusLabels[nextStatus] ? nextStatus : "draft";
}

function normalizeItem(item) {
  return {
    id: item.id || uid(),
    name: item.name || "",
    model: item.model || "",
    supplier: item.supplier || "",
    qty: numberValue(item.qty) || 1,
    unit: item.unit || "台",
    costUnit: numberValue(item.costUnit),
    quoteUnit: numberValue(item.quoteUnit),
    taxRate: item.taxRate === undefined || item.taxRate === null || item.taxRate === "" ? "" : rateValue(item.taxRate),
    leadTime: numberValue(item.leadTime),
    warranty: numberValue(item.warranty),
    spec: item.spec || ""
  };
}

function createProject() {
  const checklist = Object.fromEntries(checklistItems.map((item) => [item, false]));
  return {
    id: uid(),
    quoteNo: makeQuoteNo(),
    company: "",
    contact: "",
    name: "新招标项目",
    client: "",
    agency: "",
    budget: 0,
    deadline: "",
    status: "draft",
    bond: 0,
    taxRate: 0.13,
    targetMargin: 0.18,
    deliveryDays: 30,
    payment: "",
    warrantyMonths: 12,
    validDays: 30,
    notes: "",
    costs: {
      freight: 0,
      installation: 0,
      warranty: 0,
      service: 0,
      finance: 0,
      misc: 0
    },
    checklist,
    items: [createItem()]
  };
}

function createItem() {
  return {
    id: uid(),
    name: "",
    model: "",
    supplier: "",
    qty: 1,
    unit: "台",
    costUnit: 0,
    quoteUnit: 0,
    taxRate: "",
    leadTime: 0,
    warranty: 0,
    spec: ""
  };
}

function seedProjects() {
  const projectA = createProject();
  projectA.name = "城北热力站燃气调压设备采购";
  projectA.client = "城北能源管理有限公司";
  projectA.agency = "华信招标代理";
  projectA.budget = 980000;
  projectA.deadline = nextDate(6);
  projectA.status = "approved";
  projectA.bond = 20000;
  projectA.deliveryDays = 35;
  projectA.payment = "30%预付款，60%到货验收，10%质保金";
  projectA.warrantyMonths = 24;
  projectA.notes = "需响应防爆等级、远程监测接口和到货验收条款。";
  projectA.costs = {
    freight: 26000,
    installation: 48000,
    warranty: 18000,
    service: 12000,
    finance: 15000,
    misc: 8000
  };
  projectA.items = [
    {
      id: uid(),
      name: "燃气调压计量撬",
      model: "RX-500",
      supplier: "华北燃控设备",
      qty: 2,
      unit: "套",
      costUnit: 285000,
      quoteUnit: 380000,
      taxRate: 0.13,
      leadTime: 35,
      warranty: 24,
      spec: "满足流量、压力、过滤、计量及防爆要求"
    },
    {
      id: uid(),
      name: "远程监测终端",
      model: "RTU-4G",
      supplier: "联控自动化",
      qty: 2,
      unit: "套",
      costUnit: 18000,
      quoteUnit: 32000,
      taxRate: 0.13,
      leadTime: 20,
      warranty: 12,
      spec: "支持压力、温度、流量数据上传"
    }
  ];
  ["营业执照", "法人授权书", "技术偏离表", "商务偏离表", "报价汇总表"].forEach((item) => {
    projectA.checklist[item] = true;
  });

  const projectB = createProject();
  projectB.name = "工业园区锅炉辅机更新项目";
  projectB.client = "安泰制造集团";
  projectB.agency = "自采询价";
  projectB.budget = 620000;
  projectB.deadline = nextDate(2);
  projectB.status = "review";
  projectB.bond = 0;
  projectB.deliveryDays = 20;
  projectB.payment = "货到票到 60 天";
  projectB.warrantyMonths = 18;
  projectB.costs = {
    freight: 12000,
    installation: 32000,
    warranty: 9000,
    service: 0,
    finance: 17000,
    misc: 5000
  };
  projectB.items = [
    {
      id: uid(),
      name: "循环水泵",
      model: "LQ-220",
      supplier: "利泉泵业",
      qty: 4,
      unit: "台",
      costUnit: 62000,
      quoteUnit: 82000,
      taxRate: 0.13,
      leadTime: 15,
      warranty: 18,
      spec: "满足扬程、流量及变频控制要求"
    },
    {
      id: uid(),
      name: "变频控制柜",
      model: "VFD-75",
      supplier: "安控电气",
      qty: 2,
      unit: "台",
      costUnit: 44000,
      quoteUnit: 65000,
      taxRate: 0.13,
      leadTime: 20,
      warranty: 18,
      spec: "支持远程启停和故障报警"
    }
  ];

  return [projectA, projectB];
}

function getCurrentProject() {
  return state.projects.find((project) => project.id === currentId);
}

function parseFieldValue(fieldName, value) {
  if (rateProjectFields.has(fieldName)) {
    return rateValue(value);
  }
  if (["budget", "bond", "deliveryDays", "warrantyMonths", "validDays"].includes(fieldName)) {
    return numberValue(value);
  }
  return value;
}

function parseItemNumber(fieldName, value) {
  return rateItemFields.has(fieldName) ? rateValue(value) : numberValue(value);
}

function formatProjectInput(fieldName, value) {
  if (moneyProjectFields.has(fieldName)) return formatMoneyInput(value);
  if (rateProjectFields.has(fieldName)) return formatRateInput(value);
  if (["deliveryDays", "warrantyMonths", "validDays"].includes(fieldName)) return formatPlainNumber(value);
  return String(value ?? "");
}

function formatItemInput(fieldName, value) {
  if (moneyItemFields.has(fieldName)) return formatMoneyInput(value);
  if (rateItemFields.has(fieldName)) return formatRateInput(value);
  if (numericItemFields.has(fieldName)) return formatPlainNumber(value);
  return String(value ?? "");
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const isPercent = text.endsWith("%");
  const cleaned = text.replace(/[,%￥¥\s]/g, "");
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return isPercent ? direct / 100 : direct;
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? (isPercent ? parsed / 100 : parsed) : 0;
}

function rateValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = numberValue(raw);
  return raw.endsWith("%") || Math.abs(parsed) <= 1 ? parsed : parsed / 100;
}

function roundMoney(value) {
  return Math.round(numberValue(value) * 100) / 100;
}

function formatMoneyInput(value) {
  return decimal.format(roundMoney(value));
}

function formatRateInput(value) {
  if (value === "" || value === undefined || value === null) return "";
  const rate = rateValue(value);
  return `${(rate * 100).toFixed(2)}%`;
}

function formatPlainNumber(value) {
  const numeric = numberValue(value);
  if (!numeric) return "0";
  return Number.isInteger(numeric) ? String(numeric) : String(roundMoney(numeric));
}

function formatPercent(value) {
  return `${(numberValue(value) * 100).toFixed(1)}%`;
}

function formatClockTime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatChineseMoney(value) {
  const numeric = numberValue(value);
  const amount = Math.round(Math.abs(numeric) * 100);
  if (!amount) return "零元整";

  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const bigUnits = ["元", "万", "亿"];
  const smallUnits = ["", "拾", "佰", "仟"];
  let integer = Math.floor(amount / 100);
  const jiao = Math.floor((amount % 100) / 10);
  const fen = amount % 10;
  let integerText = "";

  for (let sectionIndex = 0; integer > 0 && sectionIndex < bigUnits.length; sectionIndex += 1) {
    let section = "";
    for (let digitIndex = 0; digitIndex < 4; digitIndex += 1) {
      const digit = integer % 10;
      if (digit) {
        section = `${digits[digit]}${smallUnits[digitIndex]}${section}`;
      } else if (section && !section.startsWith("零")) {
        section = `零${section}`;
      }
      integer = Math.floor(integer / 10);
    }
    section = section.replace(/零+/g, "零").replace(/零$/g, "");
    if (section) integerText = `${section}${bigUnits[sectionIndex]}${integerText}`;
  }

  integerText = integerText
    .replace(/零+/g, "零")
    .replace(/零(万|亿|元)/g, "$1")
    .replace(/亿万/g, "亿") || "零元";

  const fractionText = `${jiao ? `${digits[jiao]}角` : ""}${fen ? `${digits[fen]}分` : ""}`;
  return `${numeric < 0 ? "负" : ""}${integerText}${fractionText || "整"}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function nextDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function makeQuoteNo() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QT-${date}-${suffix}`;
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function sanitizeFileName(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}
