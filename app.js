const STORAGE_KEY = "tender-quote-mvp-v2";

const statusLabels = {
  draft: "待报价",
  quoted: "已报价",
  submitted: "已投标",
  won: "中标",
  lost: "未中标"
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
  maximumFractionDigits: 0
});

let state = loadState();
let currentId = state.currentId || state.projects[0]?.id;
let activeStatus = "all";
let saveTimer;

const els = {
  projectCount: document.querySelector("#projectCount"),
  statusTabs: document.querySelector("#statusTabs"),
  projectList: document.querySelector("#projectList"),
  projectTitle: document.querySelector("#projectTitle"),
  projectForm: document.querySelector("#projectForm"),
  itemsTableBody: document.querySelector("#itemsTable tbody"),
  costForm: document.querySelector("#costForm"),
  checklist: document.querySelector("#checklist"),
  metrics: document.querySelector("#metrics"),
  marginBand: document.querySelector("#marginBand"),
  riskList: document.querySelector("#riskList"),
  savedState: document.querySelector("#savedState"),
  printSheet: document.querySelector("#printSheet")
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
  persist();
  setSaved("已保存");
});

document.querySelector("#exportBtn").addEventListener("click", exportCurrentCsv);

document.querySelector("#printBtn").addEventListener("click", () => {
  renderPrintSheet();
  window.print();
});

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
els.costForm.addEventListener("input", handleCostInput);
els.checklist.addEventListener("change", handleChecklistInput);
els.itemsTableBody.addEventListener("input", handleItemInput);
els.itemsTableBody.addEventListener("click", handleItemClick);

render();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects) && parsed.projects.length) return parsed;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return {
    currentId: null,
    projects: seedProjects()
  };
}

function persist() {
  state.currentId = currentId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setSaved("已同步");
}

function scheduleSave() {
  setSaved("保存中");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 260);
}

function setSaved(text) {
  els.savedState.textContent = text;
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
      return `<button class="status-tab ${activeStatus === tab.key ? "active" : ""}" type="button" data-status="${tab.key}">${tab.label} ${count}</button>`;
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
          <p>${money.format(calc.totalQuote)} · 毛利率 ${formatPercent(calc.margin)}</p>
        </button>
      `;
    })
    .join("");
}

function renderEditor() {
  const project = getCurrentProject();
  if (!project) return;
  els.projectTitle.textContent = project.name || "未命名项目";
  els.projectForm.innerHTML = `
    ${field("项目名称", "name", "text", project.name, "span-2")}
    ${field("客户/招标单位", "client", "text", project.client, "span-2")}
    ${field("代理机构", "agency", "text", project.agency)}
    ${field("项目预算", "budget", "number", project.budget)}
    ${field("开标日期", "deadline", "date", project.deadline)}
    ${selectField("项目状态", "status", project.status, statusLabels)}
    ${field("保证金/保函", "bond", "number", project.bond)}
    ${field("税率", "taxRate", "number", project.taxRate, "", "0.13")}
    ${field("目标毛利率", "targetMargin", "number", project.targetMargin, "", "0.18")}
    ${field("交货期(天)", "deliveryDays", "number", project.deliveryDays)}
    ${field("付款方式", "payment", "text", project.payment, "span-2")}
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
    .map((item) => `
      <tr data-item-id="${item.id}">
        <td><input class="wide" data-item-field="name" value="${escapeAttr(item.name)}" /></td>
        <td><input data-item-field="model" value="${escapeAttr(item.model)}" /></td>
        <td><input inputmode="decimal" data-item-field="qty" value="${item.qty}" /></td>
        <td><input data-item-field="unit" value="${escapeAttr(item.unit)}" /></td>
        <td><input inputmode="decimal" data-item-field="costUnit" value="${item.costUnit}" /></td>
        <td><input inputmode="decimal" data-item-field="quoteUnit" value="${item.quoteUnit}" /></td>
        <td><input class="note" data-item-field="spec" value="${escapeAttr(item.spec)}" /></td>
        <td class="item-actions">
          <button class="icon-button row-delete" type="button" data-delete-item="${item.id}" aria-label="删除设备" title="删除设备">
            <svg><use href="#i-trash"></use></svg>
          </button>
        </td>
      </tr>
    `)
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
    ${metric("投标含税总价", money.format(calc.totalQuote), `不含税 ${money.format(calc.salesExTax)} · 税额 ${money.format(calc.taxAmount)}`)}
    ${metric("内部总成本", money.format(calc.totalCost), `设备成本 ${money.format(calc.itemCost)} · 费用 ${money.format(calc.extraCost)}`)}
    ${metric("预计毛利", money.format(calc.grossProfit), `毛利率 ${formatPercent(calc.margin)} · 目标 ${formatPercent(calc.targetMargin)}`)}
    ${metric("最低建议含税价", money.format(calc.minTotalQuote), `按目标毛利倒推，不含税 ${money.format(calc.minSalesExTax)}`)}
  `;

  const marginScore = clamp(calc.margin * 100, 0, 45);
  const fillClass = calc.margin < 0 ? "danger" : calc.margin < calc.targetMargin ? "warn" : "";
  els.marginBand.innerHTML = `
    <div class="band-track"><div class="band-fill ${fillClass}" style="width:${Math.max(3, (marginScore / 45) * 100)}%"></div></div>
    <div class="band-text"><span>当前毛利率 ${formatPercent(calc.margin)}</span><span>风险 ${risks.length} 项</span></div>
  `;

  if (!risks.length) {
    els.riskList.innerHTML = `<div class="risk-item low">当前项目没有明显报价风险</div>`;
    return;
  }
  els.riskList.innerHTML = `<div class="risk-list">${risks
    .map((risk) => `<div class="risk-item ${risk.level}">${risk.text}</div>`)
    .join("")}</div>`;
}

function renderPrintSheet() {
  const project = getCurrentProject();
  if (!project) return;
  const calc = calculate(project);
  els.printSheet.innerHTML = `
    <div class="print-title">
      <div>
        <h1>投标报价明细表</h1>
        <p>项目名称：${escapeHtml(project.name || "")}</p>
        <p>客户/招标单位：${escapeHtml(project.client || "")}</p>
      </div>
      <div>
        <p>报价日期：${new Date().toLocaleDateString("zh-CN")}</p>
        <p>报价有效期：${Number(project.validDays || 0)} 天</p>
      </div>
    </div>
    <div class="print-meta">
      <p>代理机构：${escapeHtml(project.agency || "-")}</p>
      <p>开标日期：${project.deadline || "-"}</p>
      <p>交货期：${Number(project.deliveryDays || 0)} 天</p>
      <p>质保期：${Number(project.warrantyMonths || 0)} 个月</p>
      <p>付款方式：${escapeHtml(project.payment || "-")}</p>
      <p>税率：${formatPercent(Number(project.taxRate || 0))}</p>
      <p>保证金/保函：${money.format(Number(project.bond || 0))}</p>
      <p>项目预算：${money.format(Number(project.budget || 0))}</p>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>设备/服务</th>
          <th>型号</th>
          <th>数量</th>
          <th>单位</th>
          <th>报价单价</th>
          <th>不含税小计</th>
          <th>参数/响应</th>
        </tr>
      </thead>
      <tbody>
        ${project.items
          .map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.model)}</td>
              <td>${Number(item.qty || 0)}</td>
              <td>${escapeHtml(item.unit)}</td>
              <td>${money.format(Number(item.quoteUnit || 0))}</td>
              <td>${money.format(Number(item.qty || 0) * Number(item.quoteUnit || 0))}</td>
              <td>${escapeHtml(item.spec)}</td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
    <div class="print-total">
      <span>不含税合计：${money.format(calc.salesExTax)}</span>
      <span>税额：${money.format(calc.taxAmount)}</span>
      <strong>含税投标总价：${money.format(calc.totalQuote)}</strong>
    </div>
    <p class="print-note">备注：${escapeHtml(project.notes || "本报价以招标文件、技术响应及双方确认范围为准。")}</p>
    <div class="print-sign">
      <span>报价单位：________________</span>
      <span>授权代表：________________</span>
      <span>日期：________________</span>
    </div>
  `;
}

function handleProjectInput(event) {
  const fieldName = event.target.dataset.projectField;
  if (!fieldName) return;
  const project = getCurrentProject();
  project[fieldName] = parseFieldValue(fieldName, event.target.value);
  updateProject(project, true);
}

function handleCostInput(event) {
  const fieldName = event.target.dataset.costField;
  if (!fieldName) return;
  const project = getCurrentProject();
  project.costs[fieldName] = numberValue(event.target.value);
  updateProject(project, true);
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
  item[fieldName] = ["qty", "costUnit", "quoteUnit"].includes(fieldName)
    ? numberValue(event.target.value)
    : event.target.value;
  updateProject(project, true);
}

function handleItemClick(event) {
  const id = event.target.closest("[data-delete-item]")?.dataset.deleteItem;
  if (!id) return;
  const project = getCurrentProject();
  if (project.items.length === 1) {
    project.items = [createItem()];
  } else {
    project.items = project.items.filter((item) => item.id !== id);
  }
  updateProject(project);
}

function updateProject(project, lightRender = false) {
  state.projects = state.projects.map((entry) => entry.id === project.id ? project : entry);
  scheduleSave();
  if (lightRender) {
    els.projectTitle.textContent = project.name || "未命名项目";
    renderProjectList();
    renderSummary();
    renderPrintSheet();
    renderStatusTabs();
  } else {
    render();
  }
}

function calculate(project) {
  const itemCost = project.items.reduce((sum, item) => sum + numberValue(item.qty) * numberValue(item.costUnit), 0);
  const salesExTax = project.items.reduce((sum, item) => sum + numberValue(item.qty) * numberValue(item.quoteUnit), 0);
  const extraCost = Object.values(project.costs).reduce((sum, value) => sum + numberValue(value), 0);
  const totalCost = itemCost + extraCost;
  const taxRate = numberValue(project.taxRate);
  const targetMargin = numberValue(project.targetMargin);
  const taxAmount = salesExTax * taxRate;
  const totalQuote = salesExTax + taxAmount;
  const grossProfit = salesExTax - totalCost;
  const margin = salesExTax > 0 ? grossProfit / salesExTax : 0;
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
    minSalesExTax,
    minTotalQuote
  };
}

function getRisks(project, calc) {
  const risks = [];
  const budget = numberValue(project.budget);
  if (calc.totalQuote > budget && budget > 0) {
    risks.push({ level: "high", text: `含税总价超过预算 ${money.format(calc.totalQuote - budget)}，容易被价格线卡住。` });
  }
  if (calc.margin < 0) {
    risks.push({ level: "high", text: "当前报价为负毛利，建议立即复核成本和单价。" });
  } else if (calc.margin < calc.targetMargin) {
    risks.push({ level: "medium", text: `毛利率低于目标 ${formatPercent(calc.targetMargin)}，至少需要补到 ${money.format(calc.minTotalQuote)} 含税价。` });
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
  if (numberValue(project.deliveryDays) <= 0) risks.push({ level: "low", text: "未填写交货期，报价单条款不完整。" });
  if (numberValue(project.warrantyMonths) <= 0) risks.push({ level: "low", text: "未填写质保期，售后成本预留可能不足。" });
  if (project.items.some((item) => !item.name || !item.model || !item.spec)) {
    risks.push({ level: "medium", text: "设备名称、型号或技术响应未填完整，可能影响技术评分。" });
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
    ["项目名称", project.name],
    ["客户/招标单位", project.client],
    ["开标日期", project.deadline],
    ["含税总价", Math.round(calc.totalQuote)],
    ["预计毛利", Math.round(calc.grossProfit)],
    ["毛利率", formatPercent(calc.margin)],
    [],
    ["设备/服务", "型号", "数量", "单位", "成本单价", "报价单价", "不含税小计", "参数/响应"],
    ...project.items.map((item) => [
      item.name,
      item.model,
      item.qty,
      item.unit,
      item.costUnit,
      item.quoteUnit,
      numberValue(item.qty) * numberValue(item.quoteUnit),
      item.spec
    ])
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

function field(label, name, type, value, className = "", placeholder = "") {
  const inputType = type === "number" ? "text" : type;
  const inputMode = type === "number" ? "decimal" : "";
  return `
    <div class="field ${className}">
      <label for="${name}">${label}</label>
      <input id="${name}" type="${inputType}" inputmode="${inputMode}" data-project-field="${name}" value="${escapeAttr(value ?? "")}" placeholder="${placeholder}" />
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
      <input id="cost-${name}" type="text" inputmode="decimal" data-cost-field="${name}" value="${numberValue(value)}" />
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

function createProject() {
  const checklist = Object.fromEntries(checklistItems.map((item) => [item, false]));
  return {
    id: uid(),
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
    qty: 1,
    unit: "台",
    costUnit: 0,
    quoteUnit: 0,
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
  projectA.status = "quoted";
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
      qty: 2,
      unit: "套",
      costUnit: 285000,
      quoteUnit: 380000,
      spec: "满足流量、压力、过滤、计量及防爆要求"
    },
    {
      id: uid(),
      name: "远程监测终端",
      model: "RTU-4G",
      qty: 2,
      unit: "套",
      costUnit: 18000,
      quoteUnit: 32000,
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
  projectB.status = "draft";
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
      qty: 4,
      unit: "台",
      costUnit: 62000,
      quoteUnit: 82000,
      spec: "满足扬程、流量及变频控制要求"
    },
    {
      id: uid(),
      name: "变频控制柜",
      model: "VFD-75",
      qty: 2,
      unit: "台",
      costUnit: 44000,
      quoteUnit: 65000,
      spec: "支持远程启停和故障报警"
    }
  ];

  return [projectA, projectB];
}

function getCurrentProject() {
  return state.projects.find((project) => project.id === currentId);
}

function parseFieldValue(fieldName, value) {
  if (["budget", "bond", "taxRate", "targetMargin", "deliveryDays", "warrantyMonths", "validDays"].includes(fieldName)) {
    return numberValue(value);
  }
  return value;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatPercent(value) {
  return `${(numberValue(value) * 100).toFixed(1)}%`;
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
