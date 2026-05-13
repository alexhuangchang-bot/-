const DEFAULT_CATEGORIES = {
    daily: [
        { id: 'food', name: '吃饭', emoji: '🍜' },
        { id: 'transport', name: '交通', emoji: '🚗' },
        { id: 'utilities', name: '水电', emoji: '💡' },
        { id: 'internet', name: '网络', emoji: '📶' },
        { id: 'phone', name: '话费', emoji: '📱' },
        { id: 'other-daily', name: '其他', emoji: '📦' }
    ],
    extra: [
        { id: 'electronics', name: '电子产品', emoji: '💻' },
        { id: 'clothes', name: '衣服', emoji: '👕' },
        { id: 'social', name: '人情往来', emoji: '🎁' },
        { id: 'travel', name: '旅游', emoji: '✈️' },
        { id: 'health', name: '健康医疗', emoji: '💊' },
        { id: 'car', name: '养车', emoji: '🔧' },
        { id: 'home', name: '家居家装', emoji: '🏠' },
        { id: 'learn', name: '学习提升', emoji: '📚' },
        { id: 'fun', name: '娱乐休闲', emoji: '🎮' },
        { id: 'other-extra', name: '其他', emoji: '💸' }
    ]
};

class DataStore {
    constructor() {
        this._sb = null;
        this._uid = null;
        this._remoteUpdatedAt = null;
        this._pushTimer = null;
        this.load();
    }

    bindCloud(supabase, userId) {
        this._sb = supabase;
        this._uid = userId;
    }

    unbindCloud() {
        if (this._pushTimer) clearTimeout(this._pushTimer);
        this._pushTimer = null;
        this._sb = null;
        this._uid = null;
        this._remoteUpdatedAt = null;
    }

    toPayload() {
        return {
            settings: this.settings,
            incomes: this.incomes,
            expenses: this.expenses,
            categories: this.categories
        };
    }

    applyPayload(parsed) {
        const defaults = {
            settings: { dailyBudget: 6300, payday: 16 },
            incomes: [],
            expenses: [],
            categories: null
        };
        if (!parsed || typeof parsed !== 'object') {
            this.settings = { ...defaults.settings };
            this.incomes = [];
            this.expenses = [];
            this.categories = DEFAULT_CATEGORIES;
            return;
        }
        this.settings = { ...defaults.settings, ...(parsed.settings || {}) };
        this.incomes = parsed.incomes || [];
        this.expenses = parsed.expenses || [];
        this.categories = parsed.categories || DEFAULT_CATEGORIES;
    }

    load() {
        const defaults = {
            settings: { dailyBudget: 6300, payday: 16 },
            incomes: [], expenses: [], categories: null
        };
        try {
            const data = localStorage.getItem('familyBudget_v2');
            if (data) {
                const parsed = JSON.parse(data);
                this.applyPayload(parsed);
            } else {
                Object.assign(this, defaults);
                this.categories = DEFAULT_CATEGORIES;
            }
        } catch (e) {
            Object.assign(this, defaults);
            this.categories = DEFAULT_CATEGORIES;
        }
    }

    save() {
        localStorage.setItem('familyBudget_v2', JSON.stringify(this.toPayload()));
        this._scheduleCloudPush();
    }

    _scheduleCloudPush() {
        if (!this._sb || !this._uid) return;
        if (this._pushTimer) clearTimeout(this._pushTimer);
        this._pushTimer = setTimeout(() => {
            this._pushTimer = null;
            this.pushImmediate().catch((e) => console.warn('cloud push', e));
        }, 700);
    }

    async pushImmediate() {
        if (!this._sb || !this._uid) return;
        if (this._pushTimer) {
            clearTimeout(this._pushTimer);
            this._pushTimer = null;
        }
        const updated_at = new Date().toISOString();
        const { error } = await this._sb.from('household_budget').upsert(
            { user_id: this._uid, payload: this.toPayload(), updated_at },
            { onConflict: 'user_id' }
        );
        if (error) throw error;
        this._remoteUpdatedAt = updated_at;
    }

    async hydrateFromSupabase(supabase, userId) {
        this.bindCloud(supabase, userId);
        const { data, error } = await supabase
            .from('household_budget')
            .select('payload, updated_at')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        if (data) {
            this.applyPayload(data.payload);
            this._remoteUpdatedAt = data.updated_at;
            localStorage.setItem('familyBudget_v2', JSON.stringify(this.toPayload()));
        } else {
            await this.pushImmediate();
        }
    }

    async pullIfNewer() {
        if (!this._sb || !this._uid) return false;
        const { data, error } = await this._sb
            .from('household_budget')
            .select('payload, updated_at')
            .eq('user_id', this._uid)
            .maybeSingle();
        if (error || !data) return false;
        const serverTs = new Date(data.updated_at).getTime();
        const knownTs = this._remoteUpdatedAt ? new Date(this._remoteUpdatedAt).getTime() : 0;
        if (serverTs <= knownTs) return false;
        this.applyPayload(data.payload);
        this._remoteUpdatedAt = data.updated_at;
        localStorage.setItem('familyBudget_v2', JSON.stringify(this.toPayload()));
        return true;
    }

    updateSettings(partial) {
        this.settings = { ...this.settings, ...partial };
        this.save();
    }

    addExpense(expense) { expense.id = Date.now().toString(); this.expenses.push(expense); this.save(); return expense; }
    updateExpense(id, updates) { const idx = this.expenses.findIndex(e => e.id === id); if (idx !== -1) { this.expenses[idx] = { ...this.expenses[idx], ...updates }; this.save(); } }
    deleteExpense(id) { this.expenses = this.expenses.filter(e => e.id !== id); this.save(); }
    addIncome(income) { income.id = Date.now().toString(); this.incomes.push(income); this.save(); return income; }
    updateIncome(id, updates) { const idx = this.incomes.findIndex(i => i.id === id); if (idx !== -1) { this.incomes[idx] = { ...this.incomes[idx], ...updates }; this.save(); } }
    deleteIncome(id) { this.incomes = this.incomes.filter(i => i.id !== id); this.save(); }
    clearAll() { this.settings = { dailyBudget: 6300, payday: 16 }; this.incomes = []; this.expenses = []; this.categories = DEFAULT_CATEGORIES; this.save(); }

    getPaydayRange(date = new Date()) {
        const payday = this.settings.payday;
        const d = new Date(date);
        const year = d.getFullYear();
        const month = d.getMonth();
        const day = d.getDate();
        let start, end;
        if (day >= payday) {
            start = new Date(year, month, payday);
            end = new Date(year, month + 1, payday - 1, 23, 59, 59);
        } else {
            start = new Date(year, month - 1, payday);
            end = new Date(year, month, payday - 1, 23, 59, 59);
        }
        return { start, end };
    }
    getLastPaydayRange(date = new Date()) {
        const payday = this.settings.payday;
        const d = new Date(date);
        const year = d.getFullYear();
        const month = d.getMonth();
        const day = d.getDate();
        let start, end;
        if (day >= payday) {
            start = new Date(year, month - 1, payday);
            end = new Date(year, month, payday - 1, 23, 59, 59);
        } else {
            start = new Date(year, month - 2, payday);
            end = new Date(year, month - 1, payday - 1, 23, 59, 59);
        }
        return { start, end };
    }
    getIncomeForRange(start, end) {
        return this.incomes.filter(inc => { const d = new Date(inc.date); return d >= start && d <= end; });
    }
    getTotalIncomeForRange(start, end) {
        return this.getIncomeForRange(start, end).reduce((sum, inc) => sum + Number(inc.amount), 0);
    }
    getExpensesForRange(start, end, type = null) {
        return this.expenses.filter(exp => {
            const d = new Date(exp.date);
            const inRange = d >= start && d <= end;
            return type ? inRange && exp.type === type : inRange;
        });
    }
    getYearsWithData() {
        const years = new Set(); years.add(new Date().getFullYear());
        this.incomes.forEach(i => years.add(new Date(i.date).getFullYear()));
        this.expenses.forEach(e => years.add(new Date(e.date).getFullYear()));
        return Array.from(years).sort((a, b) => b - a);
    }
    getYearSummary(year) {
        const today = new Date();
        const isCurrentYear = year === today.getFullYear();
        const endDate = isCurrentYear ? today : new Date(year, 11, 31, 23, 59, 59);
        const startDate = new Date(year, 0, 1);
        const yearIncomes = this.incomes.filter(i => { const d = new Date(i.date); return d >= startDate && d <= endDate; });
        const yearExpenses = this.expenses.filter(e => { const d = new Date(e.date); return d >= startDate && d <= endDate; });
        const totalIncome = yearIncomes.reduce((sum, i) => sum + Number(i.amount), 0);
        const totalExtra = yearExpenses.filter(e => e.type === 'extra').reduce((sum, e) => sum + Number(e.amount), 0);
        const monthsWithIncome = new Set(); yearIncomes.forEach(i => monthsWithIncome.add(new Date(i.date).getMonth()));
        let totalMonths = monthsWithIncome.size;
        if (isCurrentYear && totalMonths === 0) totalMonths = today.getMonth() + 1;
        else if (isCurrentYear) totalMonths = Math.max(totalMonths, today.getMonth() + 1);
        else if (totalMonths === 0) totalMonths = 12;
        const totalDaily = totalMonths * this.settings.dailyBudget;
        const totalWife = Math.max(0, totalIncome - totalDaily - totalExtra);
        return { totalIncome, totalDaily, totalExtra, totalWife, isCurrentYear };
    }
    getMonthlyBreakdown(year) {
        const today = new Date(); const isCurrentYear = year === today.getFullYear(); const months = [];
        for (let m = 0; m < 12; m++) {
            const monthEnd = new Date(year, m + 1, 0, 23, 59, 59);
            const monthStart = new Date(year, m, 1);
            const cutOff = isCurrentYear && m === today.getMonth() ? today : monthEnd;
            const monthIncomes = this.incomes.filter(i => { const d = new Date(i.date); return d >= monthStart && d <= cutOff; });
            const monthExpenses = this.expenses.filter(e => { const d = new Date(e.date); return d >= monthStart && d <= cutOff; });
            const dailyActual = monthExpenses.filter(e => e.type === 'daily').reduce((sum, e) => sum + Number(e.amount), 0);
            const extra = monthExpenses.filter(e => e.type === 'extra').reduce((sum, e) => sum + Number(e.amount), 0);
            const dailyFixed = this.settings.dailyBudget;
            const totalIncome = monthIncomes.reduce((sum, i) => sum + Number(i.amount), 0);
            const wife = totalIncome > 0 ? Math.max(0, totalIncome - dailyFixed - extra) : 0;
            months.push({ month: m, daily: dailyFixed, extra, wife, total: dailyFixed + extra + wife, hasData: dailyActual > 0 || extra > 0 || totalIncome > 0 });
        }
        return months.filter(m => m.hasData).reverse();
    }
    getExtraCategoryBreakdown(year) {
        const today = new Date(); const isCurrentYear = year === today.getFullYear();
        const endDate = isCurrentYear ? today : new Date(year, 11, 31, 23, 59, 59);
        const startDate = new Date(year, 0, 1);
        const extraExpenses = this.expenses.filter(e => { const d = new Date(e.date); return e.type === 'extra' && d >= startDate && d <= endDate; });
        const breakdown = {};
        this.categories.extra.forEach(cat => breakdown[cat.id] = { name: cat.name, emoji: cat.emoji, amount: 0 });
        extraExpenses.forEach(exp => { if (breakdown[exp.categoryId]) breakdown[exp.categoryId].amount += Number(exp.amount); });
        return Object.values(breakdown).sort((a, b) => b.amount - a.amount).filter(b => b.amount > 0);
    }
    getIncomesForYear(year) {
        const today = new Date(); const isCurrentYear = year === today.getFullYear();
        const endDate = isCurrentYear ? today : new Date(year, 11, 31, 23, 59, 59);
        const startDate = new Date(year, 0, 1);
        return this.incomes.filter(i => { const d = new Date(i.date); return d >= startDate && d <= endDate; })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }
}

class App {
    constructor(store) {
        this.store = store || new DataStore();
        this.currentExpenseType = 'extra';
        this.selectedCategory = null;
        this.selectedYear = new Date().getFullYear();
        this.editingExpenseId = null;
        this.editingIncomeId = null;
        this.expenseExpanded = false;
        this.init();
    }
    init() {
        this.bindEvents();
        this.renderCategories();
        this.updateUI();
        this.updateStatsUI();
    }
    bindEvents() {
        document.querySelectorAll('.page-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchPage(tab.dataset.page));
        });
        document.getElementById('btn-add-income').addEventListener('click', () => this.openIncomeModal());
        document.getElementById('btn-add-expense').addEventListener('click', () => this.openExpenseModal());
        document.getElementById('btn-settings').addEventListener('click', () => this.openSettingsModal());
        document.getElementById('close-expense').addEventListener('click', () => this.closeExpenseModal());
        document.getElementById('close-income').addEventListener('click', () => this.closeIncomeModal());
        document.getElementById('close-settings').addEventListener('click', () => this.closeSettingsModal());
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => { if (e.target === el) this.closeAllModals(); });
        });
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.type; this.switchExpenseType(type);
            });
        });
        document.getElementById('save-expense').addEventListener('click', () => this.saveExpense());
        document.getElementById('save-income').addEventListener('click', () => this.saveIncome());
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('clear-data').addEventListener('click', () => {
            if (confirm('确定要清除所有数据吗？')) { this.store.clearAll(); this.closeSettingsModal(); this.updateUI(); this.updateStatsUI(); }
        });
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                if (confirm('确定退出登录？')) {
                    if (typeof window.__budgetSignOut === 'function') window.__budgetSignOut();
                }
            });
        }
        document.getElementById('income-amount').addEventListener('input', () => this.updateIncomePreview());
        document.getElementById('year-select').addEventListener('change', (e) => { this.selectedYear = Number(e.target.value); this.updateStatsUI(); });
        document.getElementById('prev-year').addEventListener('click', () => { this.selectedYear--; this.updateStatsUI(); });
        document.getElementById('next-year').addEventListener('click', () => { this.selectedYear++; this.updateStatsUI(); });
        document.getElementById('prev-year-extra').addEventListener('click', () => { this.selectedYear--; this.updateExtraCategoriesPage(); });
        document.getElementById('next-year-extra').addEventListener('click', () => { this.selectedYear++; this.updateExtraCategoriesPage(); });
        document.getElementById('year-select-extra').addEventListener('change', (e) => { this.selectedYear = Number(e.target.value); this.updateExtraCategoriesPage(); });
        document.getElementById('expand-expense').addEventListener('click', () => this.toggleExpenseExpand());
        document.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.t-action-btn.edit');
            const deleteBtn = e.target.closest('.t-action-btn.delete');
            if (editBtn) {
                const id = editBtn.dataset.id;
                if (document.getElementById('income-list-full').contains(editBtn)) this.editIncome(id);
                else this.editExpense(id);
            }
            if (deleteBtn) {
                const id = deleteBtn.dataset.id;
                if (document.getElementById('income-list-full').contains(deleteBtn)) this.deleteIncome(id);
                else this.deleteExpense(id);
            }
        });
    }
    switchPage(page) {
        document.querySelectorAll('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
        document.getElementById('home-page').style.display = page === 'home' ? 'block' : 'none';
        document.getElementById('stats-page').style.display = page === 'stats' ? 'block' : 'none';
        document.getElementById('income-list-page').style.display = page === 'income-list' ? 'block' : 'none';
        document.getElementById('extra-categories-page').style.display = page === 'extra-categories' ? 'block' : 'none';
        if (page === 'stats') this.updateStatsUI();
        if (page === 'income-list') this.renderFullIncomeList();
        if (page === 'extra-categories') this.updateExtraCategoriesPage();
    }
    renderCategories() {
        const grid = document.getElementById('category-grid');
        const cats = this.store.categories[this.currentExpenseType];
        grid.innerHTML = cats.map(cat => `<button class="category-item" data-id="${cat.id}" data-name="${cat.name}" data-emoji="${cat.emoji}"><span class="category-emoji">${cat.emoji}</span><span class="category-name">${cat.name}</span></button>`).join('');
        grid.querySelectorAll('.category-item').forEach(el => {
            el.addEventListener('click', () => {
                grid.querySelectorAll('.category-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');
                this.selectedCategory = { id: el.dataset.id, name: el.dataset.name, emoji: el.dataset.emoji };
            });
        });
        if (cats.length > 0) grid.querySelector('.category-item').click();
    }
    switchExpenseType(type) {
        this.currentExpenseType = type;
        document.querySelectorAll('.type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
        this.renderCategories();
    }
    openExpenseModal(id = null) {
        this.editingExpenseId = id;
        if (id) {
            const expense = this.store.expenses.find(e => e.id === id);
            if (expense) {
                document.getElementById('expense-modal-title').textContent = '编辑支出';
                document.getElementById('expense-amount').value = expense.amount;
                document.getElementById('expense-date').value = expense.date;
                document.getElementById('expense-note').value = expense.note || '';
                this.switchExpenseType(expense.type);
                setTimeout(() => {
                    document.querySelectorAll('.category-item').forEach(el => { if (el.dataset.id === expense.categoryId) el.click(); });
                }, 50);
            }
        } else {
            document.getElementById('expense-modal-title').textContent = '记支出';
            document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('expense-amount').value = '';
            document.getElementById('expense-note').value = '';
            this.switchExpenseType('extra');
        }
        document.getElementById('expense-modal').classList.add('active');
    }
    closeExpenseModal() { this.editingExpenseId = null; document.getElementById('expense-modal').classList.remove('active'); }
    openIncomeModal(id = null) {
        this.editingIncomeId = id;
        if (id) {
            const income = this.store.incomes.find(i => i.id === id);
            if (income) {
                document.getElementById('income-modal-title').textContent = '编辑收入';
                document.getElementById('income-amount').value = income.amount;
                document.getElementById('income-source').value = income.source;
                document.getElementById('income-date').value = income.date;
                document.getElementById('income-preview-section').style.display = 'none';
            }
        } else {
            document.getElementById('income-modal-title').textContent = '记收入';
            document.getElementById('income-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('income-amount').value = '';
            document.getElementById('income-source').value = '工资';
            document.getElementById('income-preview-section').style.display = 'block';
            document.getElementById('alloc-daily').textContent = '¥' + this.store.settings.dailyBudget;
            this.loadLastExtraExpenses();
            this.updateIncomePreview();
        }
        document.getElementById('income-modal').classList.add('active');
    }
    loadLastExtraExpenses() {
        const range = this.store.getLastPaydayRange();
        const expenses = this.store.getExpensesForRange(range.start, range.end, 'extra');
        const list = document.getElementById('last-extra-list');
        if (expenses.length === 0) {
            list.innerHTML = '<p style="color:#86868b;font-size:14px;">上月无额外支出</p>';
            document.getElementById('last-extra-total').textContent = '¥0';
        } else {
            list.innerHTML = expenses.map(exp => `<div class="mini-t-item"><span class="mini-t-cat">${exp.categoryName}</span><span class="mini-t-amt">-¥${Number(exp.amount).toFixed(0)}</span></div>`).join('');
            const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
            document.getElementById('last-extra-total').textContent = '¥' + total.toFixed(0);
        }
    }
    updateIncomePreview() {
        if (this.editingIncomeId) return;
        const newIncomeAmount = Number(document.getElementById('income-amount').value) || 0;
        const dailyBudget = this.store.settings.dailyBudget;
        const range = this.store.getLastPaydayRange();
        const lastExtraExpenses = this.store.getExpensesForRange(range.start, range.end, 'extra');
        const extraTotal = lastExtraExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

        const currentRange = this.store.getPaydayRange();
        const existingIncome = this.store.getTotalIncomeForRange(currentRange.start, currentRange.end);
        const totalIncome = existingIncome + newIncomeAmount;
        const wifeAmount = Math.max(0, totalIncome - dailyBudget - extraTotal);

        document.getElementById('alloc-daily').textContent = '¥' + dailyBudget.toFixed(0);
        document.getElementById('alloc-extra').textContent = '¥' + extraTotal.toFixed(0);
        document.getElementById('alloc-wife').textContent = '¥' + wifeAmount.toFixed(0);
    }
    closeIncomeModal() { this.editingIncomeId = null; document.getElementById('income-modal').classList.remove('active'); }
    openSettingsModal() {
        document.getElementById('settings-modal').classList.add('active');
        document.getElementById('setting-daily-budget').value = this.store.settings.dailyBudget;
        document.getElementById('setting-payday').value = this.store.settings.payday;
        const emailEl = document.getElementById('settings-session-email');
        if (emailEl && typeof window.__budgetSupabase === 'function') {
            const sb = window.__budgetSupabase();
            if (sb) {
                sb.auth.getSession().then(({ data: { session } }) => {
                    emailEl.textContent = session && session.user ? session.user.email || '—' : '—';
                });
            }
        }
    }
    closeSettingsModal() { document.getElementById('settings-modal').classList.remove('active'); }
    closeAllModals() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('active')); }
    toggleExpenseExpand() {
        this.expenseExpanded = !this.expenseExpanded;
        document.getElementById('transactions-list-old').style.display = this.expenseExpanded ? 'block' : 'none';
        const btn = document.getElementById('expand-expense');
        btn.classList.toggle('expanded', this.expenseExpanded);
        btn.innerHTML = `<span class="expand-icon">${this.expenseExpanded ? '▲' : '▼'}</span> ${this.expenseExpanded ? '收起' : '更早记录'}`;
    }
    saveExpense() {
        const amount = document.getElementById('expense-amount').value;
        if (!amount || amount <= 0) { alert('请输入金额'); return; }
        if (!this.selectedCategory) { alert('请选择分类'); return; }
        const expenseData = {
            amount: Number(amount), type: this.currentExpenseType, categoryId: this.selectedCategory.id,
            categoryName: this.selectedCategory.name, categoryEmoji: this.selectedCategory.emoji,
            date: document.getElementById('expense-date').value, note: document.getElementById('expense-note').value
        };
        if (this.editingExpenseId) this.store.updateExpense(this.editingExpenseId, expenseData);
        else this.store.addExpense(expenseData);
        this.closeExpenseModal(); this.updateUI(); this.updateStatsUI();
    }
    saveIncome() {
        const amount = document.getElementById('income-amount').value;
        if (!amount || amount <= 0) { alert('请输入金额'); return; }
        let incomeData = { amount: Number(amount), source: document.getElementById('income-source').value, date: document.getElementById('income-date').value };
        if (!this.editingIncomeId) {
            const dailyBudget = this.store.settings.dailyBudget;
            const range = this.store.getLastPaydayRange();
            const lastExtraExpenses = this.store.getExpensesForRange(range.start, range.end, 'extra');
            const extraTotal = lastExtraExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
            incomeData.allocatedDaily = dailyBudget;
            incomeData.allocatedExtra = extraTotal;
        }
        if (this.editingIncomeId) this.store.updateIncome(this.editingIncomeId, incomeData);
        else this.store.addIncome(incomeData);
        this.closeIncomeModal(); this.updateUI(); this.updateStatsUI();
    }
    saveSettings() {
        const dailyBudget = Number(document.getElementById('setting-daily-budget').value) || 6300;
        const payday = Number(document.getElementById('setting-payday').value) || 16;
        this.store.updateSettings({ dailyBudget, payday });
        this.closeSettingsModal(); this.updateUI();
    }
    editExpense(id) { this.openExpenseModal(id); }
    deleteExpense(id) { if (confirm('确定要删除这条支出吗？')) { this.store.deleteExpense(id); this.updateUI(); this.updateStatsUI(); } }
    editIncome(id) { this.openIncomeModal(id); }
    deleteIncome(id) { if (confirm('确定要删除这条收入吗？')) { this.store.deleteIncome(id); this.updateUI(); this.updateStatsUI(); this.renderFullIncomeList(); } }
    formatDate(dateStr) { const d = new Date(dateStr); return `${d.getMonth() + 1}月${d.getDate()}日`; }
    formatShortDate(date) { return `${date.getMonth() + 1}月${date.getDate()}日`; }

    updateUI() {
        const range = this.store.getPaydayRange();
        const lastRange = this.store.getLastPaydayRange();
        const incomes = this.store.getIncomeForRange(range.start, range.end);
        const totalIncome = this.store.getTotalIncomeForRange(range.start, range.end);
        const lastExtraExpenses = this.store.getExpensesForRange(lastRange.start, lastRange.end, 'extra');
        const lastExtraTotal = lastExtraExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

        document.getElementById('cycle-date').textContent = `${this.formatShortDate(range.start)} - ${this.formatShortDate(range.end)}`;

        const dailyBudget = this.store.settings.dailyBudget;
        const statDaily = document.getElementById('stat-daily-budget');
        if (statDaily) statDaily.textContent = '¥' + dailyBudget.toFixed(0);

        const statIncome = document.getElementById('stat-income');
        if (totalIncome > 0) { statIncome.textContent = '¥' + totalIncome.toFixed(0); statIncome.classList.add('income'); }
        else { statIncome.textContent = '待填入'; statIncome.classList.remove('income'); }

        document.getElementById('stat-extra').textContent = '¥' + lastExtraTotal.toFixed(0);

        const statWife = document.getElementById('stat-wife');
        if (totalIncome > 0) {
            const dailyBudget = this.store.settings.dailyBudget;
            const wifeAmount = Math.max(0, totalIncome - dailyBudget - lastExtraTotal);
            statWife.textContent = '¥' + wifeAmount.toFixed(0);
            statWife.classList.add('wife');
        }
        else { statWife.textContent = '待计算'; statWife.classList.remove('wife'); }

        this.renderRecentExpenses();
    }
    renderRecentExpenses() {
        const list = document.getElementById('transactions-list');
        const oldList = document.getElementById('transactions-list-old');
        const expandBtn = document.getElementById('expand-expense');

        const allExpenses = [...this.store.expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
        if (allExpenses.length === 0) {
            list.innerHTML = `<div class="empty-state"><p>还没有支出记录</p></div>`;
            oldList.innerHTML = ''; expandBtn.style.display = 'none'; return;
        }

        const now = new Date();
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const recentExpenses = [], olderExpenses = [];
        allExpenses.forEach(exp => {
            const expDate = new Date(exp.date);
            if (expDate >= twoMonthsAgo) recentExpenses.push(exp); else olderExpenses.push(exp);
        });

        list.innerHTML = recentExpenses.map(exp => this.renderExpenseItem(exp)).join('');
        if (olderExpenses.length > 0) {
            oldList.innerHTML = olderExpenses.map(exp => this.renderExpenseItem(exp)).join('');
            expandBtn.style.display = 'flex';
        } else { oldList.innerHTML = ''; expandBtn.style.display = 'none'; }
    }
    renderExpenseItem(exp) {
        return `<div class="transaction-item"><div class="t-icon ${exp.type}">${exp.categoryEmoji}</div><div class="t-info"><div class="t-title">${exp.categoryName}</div><div class="t-subtitle">${this.formatDate(exp.date)}</div></div><div class="t-amount negative">-¥${Number(exp.amount).toFixed(0)}</div><div class="t-actions"><button class="t-action-btn edit" data-id="${exp.id}">编辑</button><button class="t-action-btn delete" data-id="${exp.id}">删除</button></div></div>`;
    }
    updateStatsUI() {
        const years = this.store.getYearsWithData();
        const yearSelect = document.getElementById('year-select');
        const minYear = Math.min(...years, this.selectedYear);
        const maxYear = Math.max(...years, this.selectedYear);
        const allYears = [];
        for (let y = minYear - 2; y <= maxYear + 2; y++) allYears.push(y);
        yearSelect.innerHTML = allYears.map(y => `<option value="${y}" ${y === this.selectedYear ? 'selected' : ''}>${y}年</option>`).join('');

        const summary = this.store.getYearSummary(this.selectedYear);
        document.getElementById('year-subtitle').textContent = summary.isCurrentYear ? '截至今天' : '全年';
        document.getElementById('sum-income').textContent = '¥' + summary.totalIncome.toFixed(0);
        document.getElementById('sum-daily').textContent = '¥' + summary.totalDaily.toFixed(0);
        document.getElementById('sum-extra').textContent = '¥' + summary.totalExtra.toFixed(0);
        document.getElementById('sum-wife').textContent = '¥' + summary.totalWife.toFixed(0);

        const months = this.store.getMonthlyBreakdown(this.selectedYear);
        const maxTotal = Math.max(...months.map(m => m.total), 1);
        const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

        document.getElementById('monthly-chart').innerHTML = months.map(m => {
            const dailyPct = (m.daily / maxTotal) * 100;
            const extraPct = (m.extra / maxTotal) * 100;
            const wifePct = (m.wife / maxTotal) * 100;
            return `
                <div class="month-bar-item">
                    <div class="month-name">${monthNames[m.month]}</div>
                    <div class="month-bar-wrap">
                        ${m.daily > 0 ? `<div class="month-seg daily" style="width:${dailyPct}%;left:0;"></div>` : ''}
                        ${m.extra > 0 ? `<div class="month-seg extra" style="width:${extraPct}%;left:${dailyPct}%;"></div>` : ''}
                        ${m.wife > 0 ? `<div class="month-seg wife" style="width:${wifePct}%;left:${dailyPct + extraPct}%;"></div>` : ''}
                    </div>
                    <div class="month-total">${m.total > 0 ? '¥' + m.total.toFixed(0) : '-'}</div>
                </div>
                <div class="month-legend">
                    <div class="legend-item"><span class="legend-color daily"></span><span class="legend-text">日常 ¥${m.daily.toFixed(0)}</span></div>
                    <div class="legend-item"><span class="legend-color extra"></span><span class="legend-text">额外 ¥${m.extra.toFixed(0)}</span></div>
                    <div class="legend-item"><span class="legend-color wife"></span><span class="legend-text">老婆 ¥${m.wife.toFixed(0)}</span></div>
                </div>`;
        }).join('');
    }
    renderFullIncomeList() {
        const list = document.getElementById('income-list-full');
        const years = this.store.getYearsWithData();
        let html = '';
        years.forEach(year => {
            const incomes = this.store.getIncomesForYear(year);
            if (incomes.length > 0) {
                html += `<div class="section-header">${year}年</div>`;
                incomes.forEach(inc => {
                    html += `<div class="income-item"><div class="income-icon">💰</div><div class="income-info"><div class="income-title">${inc.source}</div><div class="income-date">${this.formatDate(inc.date)}</div></div><div class="income-amount">+¥${Number(inc.amount).toFixed(0)}</div><div class="t-actions"><button class="t-action-btn edit" data-id="${inc.id}">编辑</button><button class="t-action-btn delete" data-id="${inc.id}">删除</button></div></div>`;
                });
            }
        });
        if (!html) html = `<div class="empty-state"><p>还没有收入记录</p></div>`;
        list.innerHTML = html;
    }
    updateExtraCategoriesPage() {
        const years = this.store.getYearsWithData();
        const yearSelect = document.getElementById('year-select-extra');
        const minYear = Math.min(...years, this.selectedYear);
        const maxYear = Math.max(...years, this.selectedYear);
        const allYears = []; for (let y = minYear - 2; y <= maxYear + 2; y++) allYears.push(y);
        yearSelect.innerHTML = allYears.map(y => `<option value="${y}" ${y === this.selectedYear ? 'selected' : ''}>${y}年</option>`).join('');

        const breakdown = this.store.getExtraCategoryBreakdown(this.selectedYear);
        const maxExtra = Math.max(...breakdown.map(b => b.amount), 1);
        document.getElementById('year-subtitle-extra').textContent = this.selectedYear === new Date().getFullYear() ? '截至今天' : '全年';
        const bdEl = document.getElementById('extra-breakdown-full');
        if (!breakdown.length) bdEl.innerHTML = '<p style="color:#86868b;text-align:center;padding:20px;">暂无额外支出</p>';
        else bdEl.innerHTML = breakdown.map(bd => `<div class="breakdown-item"><div class="bd-icon">${bd.emoji}</div><div class="bd-info"><div class="bd-name">${bd.name}</div><div class="bd-bar-wrap"><div class="bd-bar" style="width:${(bd.amount / maxExtra)*100}%;"></div></div></div><div class="bd-amount">¥${bd.amount.toFixed(0)}</div></div>`).join('');
    }
}

// 由 boot-cloud.js 在登录成功后创建：new App(store)