(function () {
    const AUTH_MODE_LOGIN = 'login';
    const AUTH_MODE_REGISTER = 'register';
    let authMode = AUTH_MODE_LOGIN;
    let supabaseClient = null;
    let appStarted = false;
    let appStarting = false;
    let pollTimer = null;

    function show(el, on) {
        if (!el) return;
        el.classList.toggle('hidden', !on);
    }

    function setAuthError(msg) {
        const el = document.getElementById('auth-error');
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.hidden = false;
        } else {
            el.textContent = '';
            el.hidden = true;
        }
    }

    function readConfig() {
        const url = (window.SUPABASE_URL || '').trim();
        const key = (window.SUPABASE_ANON_KEY || '').trim();
        if (!url || !key) return null;
        return { url, key };
    }

    function showConfigMissing() {
        const warn = document.getElementById('auth-config-warning');
        const form = document.getElementById('auth-form');
        if (warn) warn.hidden = false;
        if (form) form.querySelectorAll('input, button').forEach((n) => (n.disabled = true));
        setAuthError('');
    }

    function updateAuthToggleUI() {
        const toggle = document.getElementById('auth-toggle-mode');
        const submit = document.getElementById('auth-submit');
        if (!toggle || !submit) return;
        if (authMode === AUTH_MODE_LOGIN) {
            toggle.textContent = '没有账号？注册';
            submit.textContent = '登录';
        } else {
            toggle.textContent = '已有账号？去登录';
            submit.textContent = '注册并登录';
        }
    }

    function refreshAfterRemoteSync(app) {
        app.updateUI();
        app.updateStatsUI();
        const incPage = document.getElementById('income-list-page');
        const extraPage = document.getElementById('extra-categories-page');
        if (incPage && incPage.style.display !== 'none') app.renderFullIncomeList();
        if (extraPage && extraPage.style.display !== 'none') app.updateExtraCategoriesPage();
    }

    async function pullRemoteAndRefreshIfNeeded() {
        if (document.hidden || !window.__budgetApp) return;
        try {
            const changed = await window.__budgetApp.store.pullIfNewer();
            if (changed) refreshAfterRemoteSync(window.__budgetApp);
        } catch (e) {
            console.warn('sync', e);
        }
    }

    async function startMainApp(session) {
        if (appStarted || appStarting) return;
        appStarting = true;
        const store = new DataStore();
        try {
            await store.hydrateFromSupabase(supabaseClient, session.user.id);
        } catch (err) {
            console.error(err);
            setAuthError(err.message || '无法加载云端数据，请稍后重试');
            appStarting = false;
            return;
        }
        appStarted = true;
        appStarting = false;
        show(document.getElementById('auth-screen'), false);
        const appEl = document.querySelector('.app');
        if (appEl) appEl.classList.remove('is-hidden');

        window.__budgetApp = new App(store);

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pullRemoteAndRefreshIfNeeded, 40000);

        document.addEventListener('visibilitychange', pullRemoteAndRefreshIfNeeded);
    }

    async function boot() {
        const cfg = readConfig();
        if (!cfg) {
            showConfigMissing();
            return;
        }

        if (typeof supabase === 'undefined' || !supabase.createClient) {
            setAuthError('未能加载 Supabase 脚本，请检查网络后刷新页面');
            return;
        }

        supabaseClient = supabase.createClient(cfg.url, cfg.key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });

        const form = document.getElementById('auth-form');
        const toggle = document.getElementById('auth-toggle-mode');
        if (toggle) {
            toggle.addEventListener('click', () => {
                authMode = authMode === AUTH_MODE_LOGIN ? AUTH_MODE_REGISTER : AUTH_MODE_LOGIN;
                setAuthError('');
                updateAuthToggleUI();
            });
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                setAuthError('');
                const email = (document.getElementById('auth-email') || {}).value.trim();
                const password = (document.getElementById('auth-password') || {}).value;
                const submitBtn = document.getElementById('auth-submit');
                if (submitBtn) submitBtn.disabled = true;
                try {
                    if (authMode === AUTH_MODE_REGISTER) {
                        const { data, error } = await supabaseClient.auth.signUp({ email, password });
                        if (error) throw error;
                        if (data.session) await startMainApp(data.session);
                        else {
                            setAuthError(
                                '注册成功。若项目开启了「邮箱确认」，请到邮箱点击链接后再登录。未开启确认则会自动登录。'
                            );
                        }
                    } else {
                        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                        if (error) throw error;
                        if (data.session) await startMainApp(data.session);
                    }
                } catch (err) {
                    setAuthError(err.message || String(err));
                } finally {
                    if (submitBtn) submitBtn.disabled = false;
                }
            });
        }

        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session && !appStarted) {
                await startMainApp(session);
            }
        });

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) await startMainApp(session);
        else {
            show(document.getElementById('auth-screen'), true);
            updateAuthToggleUI();
        }
    }

    window.__budgetSignOut = async function () {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (supabaseClient) await supabaseClient.auth.signOut();
        location.reload();
    };

    window.__budgetSupabase = function () {
        return supabaseClient;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot().catch(console.error));
    } else {
        boot().catch(console.error);
    }
})();
