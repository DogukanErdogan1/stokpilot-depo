const roleLabels = { admin: "Yönetici", operator: "Depo görevlisi", viewer: "Salt okunur" };
let teamState = { page: 1, result: null, loading: false, error: "", reader: null };

function canEditCatalog() { return currentUser?.role === "admin"; }
function canChangeStock() { return currentUser?.role === "admin" || currentUser?.role === "operator"; }
function canManageTeam() { return canEditCatalog() && !currentUser.isDemo; }

function userRoleLabel(user) {
  const role = roleLabels[user.role] || "Kullanıcı";
  return user.isDemo ? `${role} · Demo` : role;
}

function resetTeamScreen() {
  teamState.reader?.abort();
  teamState = { page: 1, result: null, loading: false, error: "", reader: null };
}

async function loadTeam(page = teamState.page, showLoading = true) {
  if (!canManageTeam()) return;
  const screen = teamState;
  screen.reader?.abort();
  const reader = new AbortController();
  screen.reader = reader;
  screen.loading = true;
  screen.error = "";
  if (showLoading && currentView === "team") render();
  try {
    const result = await api(`/team?${new URLSearchParams({ page: String(page), pageSize: "20" })}`, { signal: reader.signal });
    if (reader.signal.aborted || screen !== teamState) return;
    screen.result = result;
    screen.page = result.pagination.page;
  } catch (error) {
    if (!reader.signal.aborted && screen === teamState) screen.error = error.message;
  } finally {
    if (!reader.signal.aborted && screen === teamState) {
      screen.loading = false;
      if (currentView === "team") render();
    }
  }
}

function ensureTeam() {
  if (!teamState.result && !teamState.loading && !teamState.error) void loadTeam(1, false);
}

function renderTeam() {
  const { result, loading, error } = teamState;
  const pager = result?.pagination;
  const items = result?.items || [];
  return pageHeading("İŞLETME", "Ekip", "Çalışma alanındaki hesapları ve erişimlerini yönet.",
    `<button class="button button-primary" type="button" data-action="team-add">${icon("plus")} Üye ekle</button>`)
    + `<div class="team-roles">
      <div><strong>Yönetici</strong><span>Ekibi, ürünleri, depoları ve stok işlemlerini yönetir.</span></div>
      <div><strong>Depo görevlisi</strong><span>Stok girişi, çıkışı, transfer ve sayım yapar.</span></div>
      <div><strong>Salt okunur</strong><span>Kayıtları ve işlem geçmişini görüntüler, CSV indirebilir.</span></div>
    </div>
    <section class="panel team-panel" aria-busy="${loading}">
      <header class="panel-header"><div><h2 class="panel-title">Ekip üyeleri</h2><p class="panel-subtitle">${pager ? `${number(pager.total)} hesap` : "Çalışma alanı erişimi"}</p></div></header>
      ${loading ? '<p class="team-state" role="status">Üyeler yükleniyor…</p>'
        : error ? `<div class="team-state" role="alert"><p>${esc(error)}</p><button class="button" type="button" data-action="team-retry">Tekrar dene</button></div>`
        : `<ul class="team-members">${items.map(member => `<li>
          <div class="team-member"><span class="team-initials" aria-hidden="true">${esc(getUserInitials(member))}</span><div><strong>${esc(member.fullName)}</strong><small>${esc(member.email)}</small></div></div>
          <span class="team-role-chip">${roleLabels[member.role]}</span>
          <span class="team-availability ${member.active ? "is-active" : ""}">${member.active ? "Aktif" : "Pasif"}</span>
          ${member.id === currentUser.id ? '<span class="team-self">Sen</span>'
            : `<button class="button button-small" type="button" data-action="team-edit" data-member-id="${esc(member.id)}" aria-label="${esc(member.fullName)} hesabını düzenle">Düzenle</button>`}
        </li>`).join("")}</ul>
        ${pager?.totalPages > 1 ? `<div class="count-pager"><p>Sayfa ${number(pager.page)} / ${number(pager.totalPages)}</p>
          <div><button class="button" type="button" data-action="team-page" data-page="${pager.page - 1}" ${pager.hasPrevious ? "" : "disabled"}>Önceki</button>
          <button class="button" type="button" data-action="team-page" data-page="${pager.page + 1}" ${pager.hasNext ? "" : "disabled"}>Sonraki</button></div></div>` : ""}`}
    </section>`;
}

function openTeamMemberForm(member) {
  if (!canManageTeam()) return;
  const editing = Boolean(member);
  const role = member?.role || "viewer";
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
    <header class="modal-head"><div><h2 id="team-modal-title">${editing ? "Üyeyi düzenle" : "Ekip üyesi ekle"}</h2>
      <p>${editing ? esc(member.fullName) : "Üye, bu e-posta ve parolayla giriş yapabilir."}</p></div>
      <button class="modal-close" type="button" data-action="close-modal" aria-label="Kapat">${icon("close")}</button></header>
    <form class="modal-form" id="team-member-form" ${editing ? `data-member-id="${esc(member.id)}"` : ""}>
      <div class="form-grid">
      ${editing ? "" : `<div class="form-field full"><label for="team-name">Ad soyad</label><input id="team-name" name="fullName" required maxlength="100" autocomplete="off"></div>
      <div class="form-field full"><label for="team-email">E-posta</label><input id="team-email" name="email" type="email" required maxlength="254" autocomplete="off"></div>
      <div class="form-field full"><label for="team-password">İlk parola</label><input id="team-password" name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password">
        <span class="field-hint">En az 12 karakter kullan.</span></div>`}
      <div class="form-field full"><label for="team-role">Rol</label><select id="team-role" name="role">
        ${Object.entries(roleLabels).map(([value, label]) => `<option value="${value}" ${role === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></div>
      ${editing ? `<div class="form-field full"><label for="team-access">Erişim durumu</label><select id="team-access" name="active">
        <option value="true" ${member.active ? "selected" : ""}>Aktif</option><option value="false" ${member.active ? "" : "selected"}>Pasif</option>
      </select><span class="field-hint">Pasife alınan hesabın açık oturumları kapatılır.</span></div>` : ""}
      </div>
      <div class="form-error" id="team-form-error" role="alert"></div>
      <div class="modal-actions"><button class="button" type="button" data-action="close-modal">Vazgeç</button>
        <button class="button button-primary" type="submit">${editing ? "Değişiklikleri kaydet" : "Hesap oluştur"}</button></div>
    </form>
  </section></div>`;
  beginModal();
  $(editing ? "#team-role" : "#team-name")?.focus();
}

async function saveTeamMember(form) {
  const submit = $("button[type='submit']", form);
  if (!canManageTeam() || submit.disabled || !form.reportValidity()) return;
  const fields = new FormData(form);
  const id = form.dataset.memberId;
  const payload = id ? { role: fields.get("role"), active: fields.get("active") === "true" } : Object.fromEntries(fields);
  const error = $("#team-form-error", form);
  submit.disabled = true;
  error.classList.remove("visible");
  try {
    await api(id ? `/team/${encodeURIComponent(id)}` : "/team", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    if (form.isConnected) closeModal();
    if (!canManageTeam()) return;
    showToast(id ? "Üye bilgileri güncellendi." : "Ekip üyesi oluşturuldu.");
    await loadTeam();
  } catch (problem) {
    error.textContent = problem.message;
    error.classList.add("visible");
  } finally {
    submit.disabled = false;
  }
}

function handleTeamAction(action, button) {
  if (!canManageTeam()) return;
  if (action === "team-add") openTeamMemberForm();
  if (action === "team-edit") {
    const member = teamState.result?.items.find(item => item.id === button.dataset.memberId);
    if (member && member.id !== currentUser.id) openTeamMemberForm(member);
  }
  if (action === "team-retry") void loadTeam();
  if (action === "team-page") void loadTeam(Number(button.dataset.page));
}
