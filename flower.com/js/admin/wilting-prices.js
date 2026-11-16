const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
const scopeLabels = { all: "Toàn bộ", group: "Nhóm sản phẩm", product: "Từng sản phẩm" };

export async function initializeWiltingPrices({ root, getToken }) {
    if (!root) return;
    root.innerHTML = `
        <h2>Giá héo tự động</h2>
        <p>Giá gốc và tồn kho được giữ nguyên. Giá héo tính theo ngày Việt Nam từ ngày nhập của tồn kho hiện tại,
        giảm tuyến tính trên giá gốc, rồi mới tính khuyến mãi. Thiếu ngày nhập thì giữ giá gốc.</p>
        <p>Ưu tiên: từng sản phẩm → nhóm sản phẩm → toàn bộ. Mỗi sản phẩm trong nhóm được tính riêng.</p>
        <p id="wilting-status" role="status" aria-live="polite">Đang tải cấu hình giá héo…</p>
        <button id="wilting-retry" class="secondary-btn" type="button" hidden>Tải lại cấu hình giá héo</button>
        <fieldset id="wilting-controls" disabled>
            <legend>Cấu hình của Owner</legend>
            <label><input id="wilting-enabled" type="checkbox"> Bật giá héo (mặc định tắt)</label>
            <p>Thêm/xóa quy tắc và bật/tắt chỉ có hiệu lực sau khi bấm <strong>Lưu cấu hình</strong>.</p>
            <form id="wilting-rule-form" class="wilting-form">
                <label>Tên quy tắc<input id="wilting-name" maxlength="80" required></label>
                <label>Phạm vi<select id="wilting-scope"><option value="all">Toàn bộ</option><option value="group">Nhóm sản phẩm</option><option value="product">Từng sản phẩm</option></select></label>
                <label>Sản phẩm áp dụng<select id="wilting-targets" multiple size="5" disabled aria-describedby="wilting-target-help"></select></label>
                <p id="wilting-target-help">Nhóm: chọn một hoặc nhiều sản phẩm. Từng sản phẩm: chọn đúng một.</p>
                <label>Bắt đầu khi hoa đủ số ngày<input id="wilting-start" type="number" min="0" max="3650" step="1" required value="1"></label>
                <label>Giảm mỗi ngày (%)<input id="wilting-percent" type="number" min="1" max="100" step="1" required></label>
                <label>Giá sàn mỗi đơn vị (VND)<input id="wilting-floor" type="number" min="1000" max="1000000000" step="1" required></label>
                <button class="secondary-btn" type="submit">Thêm quy tắc vào bản nháp</button>
            </form>
            <p>Ví dụ: bắt đầu ở ngày 1, giảm 10%/ngày thì ngày 1 còn 90%, ngày 2 còn 80% giá gốc; không thấp hơn giá sàn. Ngày 0 là ngày nhập.</p>
            <div class="table-wrap"><table class="users-table"><thead><tr><th>Quy tắc</th><th>Phạm vi</th><th>Công thức</th><th>Thao tác</th></tr></thead><tbody id="wilting-rules"></tbody></table></div>
            <div class="wilting-actions"><button id="wilting-save" class="primary-btn" type="button">Lưu cấu hình</button><button id="wilting-reload" class="secondary-btn" type="button">Tải lại từ máy chủ</button></div>
            <h3>Ngày nhập và giá hiện tại</h3>
            <p>Ngày nhập áp dụng cho toàn bộ tồn kho của sản phẩm. Khi nhập lô mới, Owner cần cập nhật ngày; hệ thống chưa chia tồn kho theo nhiều lô.</p>
            <label>Tìm sản phẩm<input id="wilting-search" type="search" placeholder="Tên hoặc mã sản phẩm"></label>
            <div class="table-wrap"><table class="users-table"><thead><tr><th>Sản phẩm</th><th>Giá gốc</th><th>Giá hiện tại</th><th>Ngày nhập</th><th>Thao tác</th></tr></thead><tbody id="wilting-products"></tbody></table></div>
        </fieldset>`;
    const byId = id => root.querySelector(`#${id}`);
    const status = byId("wilting-status");
    const controls = byId("wilting-controls");
    let settings = { enabled: false, rules: [], revision: 0 }, products = [], today = "";
    let busy = false, loaded = false, dirty = false;
    async function api(body) {
        const token = await getToken();
        const response = await fetch("/api/wilting-prices", {
            method: body ? "POST" : "GET", cache: "no-store",
            headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        let data;
        try { data = await response.json(); } catch { throw new Error("API giá héo chưa sẵn sàng. Hãy kiểm tra backend."); }
        if (!response.ok) throw new Error(data.error || "Chưa thể xử lý cấu hình giá héo.");
        return data;
    }
    function cell(row, value) { const node = document.createElement("td"); node.textContent = String(value); row.append(node); return node; }
    function draft() { dirty = true; status.textContent = "Bản nháp đã thay đổi; chưa áp dụng cho khách hàng. Bấm Lưu cấu hình để áp dụng."; }
    function renderRules() {
        const body = byId("wilting-rules"); body.replaceChildren();
        for (const rule of settings.rules) {
            const row = document.createElement("tr");
            cell(row, rule.name);
            cell(row, scopeLabels[rule.scope] + (rule.productIds.length ? `: ${rule.productIds.map(id => products.find(product => product.id === id)?.title || id).join(", ")}` : ""));
            cell(row, `${rule.enabled ? "Bật" : "Tắt"} · từ ngày ${rule.startAfterDays}, −${rule.dailyDiscountPercent}%/ngày, sàn ${currency.format(rule.minPrice)}`);
            const button = document.createElement("button"); button.type = "button"; button.className = "secondary-btn"; button.textContent = "Xóa khỏi bản nháp";
            button.addEventListener("click", () => { settings.rules = settings.rules.filter(item => item.id !== rule.id); renderRules(); draft(); });
            cell(row, "").append(button); body.append(row);
        }
        if (!settings.rules.length) { const row = document.createElement("tr"); const node = cell(row, "Chưa có quy tắc; giữ giá gốc."); node.colSpan = 4; body.append(row); }
    }
    function renderProducts() {
        const body = byId("wilting-products"); body.replaceChildren();
        const search = byId("wilting-search").value.trim().toLocaleLowerCase("vi");
        products.filter(product => `${product.title} ${product.id}`.toLocaleLowerCase("vi").includes(search)).forEach((product, index) => {
            const row = document.createElement("tr"); cell(row, `${product.title} (${product.id})`);
            cell(row, currency.format(product.basePrice)); cell(row, currency.format(product.effectivePrice));
            const label = document.createElement("label"); label.textContent = "Ngày nhập ";
            const input = document.createElement("input"); input.type = "date"; input.max = today; input.value = product.receivedDate; input.id = `wilting-received-${index}`;
            label.htmlFor = input.id; label.append(input); cell(row, "").append(label);
            const save = document.createElement("button"); save.type = "button"; save.className = "secondary-btn"; save.textContent = "Lưu ngày nhập";
            save.addEventListener("click", async () => {
                if (busy || !input.reportValidity()) return;
                await operation(async () => {
                    await api({ action: "set-received-date", productId: product.id, receivedDate: input.value, expectedReceivedDate: product.receivedDate });
                    await load(dirty); status.textContent = "Đã lưu ngày nhập và cập nhật giá hiện tại. Quy tắc đang tắt sẽ chưa giảm giá." + (dirty ? " Bản nháp quy tắc vẫn chưa được lưu." : "");
                });
            });
            cell(row, "").append(save); body.append(row);
        });
    }
    async function load(preserveDraft = false) {
        const data = await api(); products = data.products; today = data.today;
        if (!preserveDraft) { settings = data.settings; dirty = false; byId("wilting-enabled").checked = settings.enabled; }
        loaded = true;
        byId("wilting-retry").hidden = true;
        const select = byId("wilting-targets"); select.replaceChildren();
        products.forEach(product => { const option = document.createElement("option"); option.value = product.id; option.textContent = `${product.title} (${product.id})`; select.append(option); });
        renderRules(); renderProducts();
        status.textContent = settings.enabled ? "Giá héo đang bật; giá được máy chủ tính lại theo ngày Việt Nam." : "Giá héo đang tắt. Khách hàng tiếp tục dùng giá gốc.";
    }
    async function operation(work) {
        if (busy) return;
        busy = true; controls.disabled = true;
        try { await work(); } catch (error) { status.textContent = error.message || "Không thể lưu. Hãy thử lại."; }
        finally { busy = false; controls.disabled = !loaded; }
    }
    byId("wilting-enabled").addEventListener("change", draft);
    byId("wilting-scope").addEventListener("change", event => { byId("wilting-targets").disabled = event.target.value === "all"; });
    byId("wilting-search").addEventListener("input", renderProducts);
    byId("wilting-rule-form").addEventListener("submit", event => {
        event.preventDefault();
        if (busy) return;
        const scope = byId("wilting-scope").value;
        const productIds = scope === "all" ? [] : Array.from(byId("wilting-targets").selectedOptions, option => option.value);
        if ((scope === "product" && productIds.length !== 1) || (scope === "group" && !productIds.length)) {
            status.textContent = "Hãy chọn đúng số sản phẩm cho phạm vi quy tắc."; return;
        }
        if (settings.rules.length >= 50) { status.textContent = "Tối đa 50 quy tắc."; return; }
        settings.rules.push({ id: crypto.randomUUID(), name: byId("wilting-name").value.trim(), enabled: true, scope, productIds,
            startAfterDays: Number(byId("wilting-start").value), dailyDiscountPercent: Number(byId("wilting-percent").value), minPrice: Number(byId("wilting-floor").value) });
        renderRules(); draft();
    });
    byId("wilting-save").addEventListener("click", () => operation(async () => {
        await api({ action: "save-rules", enabled: byId("wilting-enabled").checked, rules: settings.rules, expectedRevision: settings.revision });
        await load(); status.textContent = "Đã lưu cấu hình giá héo.";
    }));
    byId("wilting-reload").addEventListener("click", () => operation(load));
    byId("wilting-retry").addEventListener("click", () => operation(load));
    try { await load(); controls.disabled = false; }
    catch (error) { status.textContent = error.message || "Chưa tải được giá héo."; byId("wilting-retry").hidden = false; }
}
