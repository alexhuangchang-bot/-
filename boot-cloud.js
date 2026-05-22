(function () {
    const AUTH_MODE_LOGIN = 'login';
    const AUTH_MODE_REGISTER = 'register';
    let authMode = AUTH_MODE_LOGIN;
    let supabaseClient = null;
    let appStarted = false;
    let appStarting = false;
    let startMainAppPromise = null;
    let pollTimer = null;
    let authActionInFlight = false;

    function withTimeout(promise, ms, message) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(message)), ms);
            })
        ]);
    }

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

    function friendlyError(err) {
        const msg = (err && (err.message || err.msg || err.error_description)) || String(err || '');
        if (/invalid login credentials/i.test(msg)) return '邮箱或密码不正确，请检查后重试。';
        if (/email not confirmed/i.test(msg)) return '邮箱尚未确认。请到邮箱点击确认链接，或联系管理员在 Supabase 关闭「邮箱确认」。';
        if (/household_budget|relation|does not exist/i.test(msg)) return '云端数据表未创建。请在 Supabase 的 SQL Editor 执行项目里的 supabase/schema.sql。';
        if (/row-level security|policy|permission|42501/i.test(msg)) return '云端权限未配置好。请确认已执行 supabase/schema.sql 中的 RLS 策略。';
        if (/fetch|network|failed to fetch/i.test(msg)) return '网络连接失败，请检查网络后重试。';
        if (/超时|timeout/i.test(msg)) return msg;
        return msg || '操作失败，请稍后重试。';
    }

    function setAuthLoading(loading) {
        const submitBtn = document.getElementById('auth-submit');
        const form = document.getElementById('auth-form');
        if (submitBtn) {
            submitBtn.disabled = loading;
            submitBtn.textContent = loading ? '请稍候…' : (authMode === AUTH_MODE_REGISTER ? '注册并登录' : '登录');
        }
        if (form) form.querySelectorAll('input').forEach((n) => { n.disabled = loading; });
    }

    function readConfig() {
        const url = (window.SUPABASE_URL || '').trim();
        const key = (window.SUPABASE_ANON_KEY || '').trim();
        if (!url || !key) return null;
        return { url, key };
    }

    function showConfigMissing() {
        const warn = document.getElementById('auth-config-warning');
        if (warn) warn.hidden = false;
    }

    function hideConfigWarning() {
        const warn = document.getElementById('auth-config-warning');
        if (warn) warn.hidden = true;
    }

    function supabaseReady() {
        return typeof supabase !== 'undefined' && typeof supabase.createClient === 'function';
    }

    function waitForSupabase(maxMs) {
        return new Promise((resolve) => {
            if (supabaseReady()) {
                resolve(true);
                return;
            }
            const start = Date.now();
            const timer = setInterval(() => {
                if (supabaseReady()) {
                    clearInterval(timer);
                    resolve(true);
                } else if (Date.now() - start >= maxMs) {
                    clearInterval(timer);
                    resolve(false);
                }
            }, 80);
        });
    }

    function initSupabaseClient() {
        const cfg = readConfig();
        if (!cfg || !supabaseReady()) return false;
        if (!supabaseClient) {
            supabaseClient = supabase.createClient(cfg.url, cfg.key, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    // 避免与 signInWithPassword 争用浏览器锁导致一直「请稍候…」
                    lock: async (_name, _acquireTimeout, fn) => await fn()
                }
            });
            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (authActionInFlight || appStarted || appStarting) return;
                if (event === 'SIGNED_IN' && session) {
                    queueMicrotask(() => {
                        startMainApp(session).catch((err) => console.error('auth state:', err));
                    });
                }
            });
        }
        return true;
    }

    function bindAuthHandlers() {
        const form = document.getElementById('auth-form');
        const toggle = document.getElementById('auth-toggle-mode');
        if (toggle && !toggle.dataset.bound) {
            toggle.dataset.bound = '1';
            toggle.addEventListener('click', () => {
                authMode = authMode === AUTH_MODE_LOGIN ? AUTH_MODE_REGISTER : AUTH_MODE_LOGIN;
                setAuthError('');
                updateAuthToggleUI();
            });
        }
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';
        form.setAttribute('novalidate', 'novalidate');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            runAuthSubmit().catch((err) => {
                console.error('auth submit:', err);
                setAuthError(friendlyError(err));
                setAuthLoading(false);
            });
        });
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
        if (appStarted) return;
        if (startMainAppPromise) {
            await startMainAppPromise;
            return;
        }
        if (!session || !session.user) {
            setAuthError('登录会话无效，请重新登录。');
            show(document.getElementById('auth-screen'), true);
            return;
        }

        startMainAppPromise = (async () => {
            appStarting = true;
            setAuthError('');
            const store = new DataStore();
            try {
                await withTimeout(
                    store.hydrateFromSupabase(supabaseClient, session.user.id),
                    25000,
                    '加载云端数据超时，请检查网络后刷新重试。'
                );
            } catch (err) {
                console.error('hydrate failed:', err);
                setAuthError('登录成功，但加载云端数据失败：' + friendlyError(err));
                show(document.getElementById('auth-screen'), true);
                return;
            }
            try {
                show(document.getElementById('auth-screen'), false);
                const appEl = document.querySelector('.app');
                if (appEl) appEl.classList.remove('is-hidden');
                window.__budgetApp = new App(store);
                appStarted = true;
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(pullRemoteAndRefreshIfNeeded, 40000);
                document.addEventListener('visibilitychange', pullRemoteAndRefreshIfNeeded);
            } catch (err) {
                console.error('App start failed:', err);
                appStarted = false;
                window.__budgetApp = null;
                show(document.getElementById('auth-screen'), true);
                const appEl = document.querySelector('.app');
                if (appEl) appEl.classList.add('is-hidden');
                setAuthError('进入主页失败：' + friendlyError(err));
            }
        })();

        try {
            await startMainAppPromise;
        } finally {
            appStarting = false;
            startMainAppPromise = null;
        }
    }

    async function runAuthSubmit() {
        setAuthError('');
        const emailEl = document.getElementById('auth-email');
        const passEl = document.getElementById('auth-password');
        const email = (emailEl && emailEl.value || '').trim();
        const password = passEl ? passEl.value : '';
        if (!email) {
            setAuthError('请填写邮箱。');
            emailEl && emailEl.focus();
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setAuthError('邮箱格式不正确，请检查后再试。');
            emailEl && emailEl.focus();
            return;
        }
        if (!password || password.length < 6) {
            setAuthError('密码至少 6 位。');
            passEl && passEl.focus();
            return;
        }

        const cfg = readConfig();
        if (!cfg) {
            showConfigMissing();
            setAuthError('请填写 Supabase 配置（supabase-config.js）后重新发布本站。');
            return;
        }
        hideConfigWarning();
        if (!initSupabaseClient()) {
            const ok = await waitForSupabase(8000);
            if (!ok || !initSupabaseClient()) {
                setAuthError('未能加载登录组件，请刷新页面或换网络后重试。');
                return;
            }
        }

        setAuthLoading(true);
        authActionInFlight = true;
        try {
            if (authMode === AUTH_MODE_REGISTER) {
                const { data, error } = await withTimeout(
                    supabaseClient.auth.signUp({ email, password }),
                    20000,
                    '注册请求超时，请检查网络后重试。'
                );
                if (error) throw error;
                if (data.session) await startMainApp(data.session);
                else {
                    setAuthError(
                        '注册成功。若开启了邮箱确认，请到邮箱点击链接后再登录；未开启确认则请直接点「登录」。'
                    );
                }
            } else {
                const { data, error } = await withTimeout(
                    supabaseClient.auth.signInWithPassword({ email, password }),
                    20000,
                    '登录请求超时，请检查网络后重试。'
                );
                if (error) throw error;
                if (data.session) {
                    await startMainApp(data.session);
                    if (!appStarted) {
                        setAuthError('登录成功，但未能进入主页，请再点一次「登录」或刷新页面。');
                    }
                } else {
                    setAuthError('登录需要邮箱确认。请到邮箱点击确认链接后再试，或在 Supabase 关闭「Confirm email」。');
                }
            }
        } catch (err) {
            console.error('auth failed:', err);
            setAuthError(friendlyError(err));
            show(document.getElementById('auth-screen'), true);
        } finally {
            authActionInFlight = false;
            setAuthLoading(false);
            updateAuthToggleUI();
        }
    }

    async function boot() {
        bindAuthHandlers();
        updateAuthToggleUI();

        if (location.protocol === 'file:') {
            setAuthError('请先在终端运行 node server.js，再用浏览器打开 http://localhost:8080（不要直接双击 index.html）。');
            return;
        }

        const cfg = readConfig();
        if (!cfg) {
            showConfigMissing();
            return;
        }
        hideConfigWarning();

        if (!initSupabaseClient()) {
            await waitForSupabase(3000);
            if (!initSupabaseClient()) {
                setAuthError('登录组件未就绪，请刷新页面；点击「登录」将自动重试。');
                return;
            }
        }

        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) {
            setAuthError(sessionError.message || '无法读取登录状态');
            show(document.getElementById('auth-screen'), true);
            updateAuthToggleUI();
            return;
        }
        if (session) {
            setAuthLoading(true);
            try {
                await withTimeout(startMainApp(session), 25000, '自动登录超时，请手动点「登录」。');
            } catch (err) {
                console.error('auto login:', err);
                setAuthError(friendlyError(err));
                try {
                    await supabaseClient.auth.signOut();
                } catch (e) {
                    console.warn('signOut', e);
                }
            } finally {
                setAuthLoading(false);
                updateAuthToggleUI();
            }
        } else {
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
