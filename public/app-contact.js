// Fiche contact (/p/:id/contact/:cid) : prochaine action, notes, informations, accroche, « Passer en client » et suppression. La page est rendue par le serveur ;
// ces formulaires appellent les routes d'API de la fiche prospect. Chargé après app.js (window.AiTools) ; ajax.js relance ce script à chaque navigation (tout passe par listen).
(() => {
  const { $, $$, api, confirmBox, formData, go, listen, toast, aiName } = window.AiTools;
  const root = $('[data-contact]');
  if (!root) return;
  const id = root.dataset.prospectId;
  const project = root.dataset.projectId;
  const again = () => (window.AiNav ? window.AiNav.reload() : location.reload());
  const fail = (err) => toast(err.message, 'error');

  const toggle = (btn, sel) => {
    const box = $(sel, root);
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('input, textarea', box)?.focus();
  };
  listen(root, 'click', async (e) => {
    const t = e.target;
    const noteBtn = t.closest('[data-contact-note-toggle]');
    if (noteBtn) return toggle(noteBtn, '[data-contact-form="note"]');
    const editBtn = t.closest('[data-contact-edit-toggle]');
    if (editBtn) return toggle(editBtn, '[data-contact-form="edit"]');
    try {
      if (t.closest('[data-contact-clear-next]')) { await api(`/api/prospects/${id}/next`, { action: '' }); toast('Prochaine action effacée'); again(); return; }
      const del = t.closest('[data-del-note]');
      if (del) { if (await confirmBox('Supprimer cette note ?')) { await api(`/api/prospects/${id}/notes/${del.dataset.delNote}/delete`, {}); again(); } return; }
      if (t.closest('[data-contact-client]')) { await api(`/api/prospects/${id}/status`, { status: 'client' }); toast('Prospect passé en client'); again(); return; }
      const hook = t.closest('[data-contact-hook]');
      if (hook) {
        hook.disabled = true;
        await api(`/api/prospects/${id}/hook`, {});
        toast(`Accroche en cours de rédaction : ${aiName()} lit le site du prospect`);
        return;
      }
      if (t.closest('[data-contact-delete]')) {
        const name = $('h1', root)?.textContent || 'ce prospect';
        if (!(await confirmBox(`Supprimer définitivement « ${name} » ?\nSes notes seront supprimées. Les mails déjà envoyés restent dans la page Mails.`))) return;
        await api(`/api/prospects/${id}/delete`, {});
        toast('Prospect supprimé');
        go(`/p/${project}/prospection`);
      }
    } catch (err) { fail(err); }
  });
  listen(root, 'submit', async (e) => {
    const form = e.target.closest('form[data-contact-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.contactForm;
    try {
      if (kind === 'note') await api(`/api/prospects/${id}/notes`, formData(form));
      else if (kind === 'edit') await api(`/api/prospects/${id}/update`, formData(form));
      else await api(`/api/prospects/${id}/next`, formData(form));
      toast(kind === 'note' ? 'Note ajoutée' : kind === 'edit' ? 'Informations enregistrées' : 'Prochaine action enregistrée');
      again();
    } catch (err) { fail(err); }
  });
})();
