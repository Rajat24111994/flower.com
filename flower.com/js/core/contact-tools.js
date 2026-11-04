(function addFlowerflowContactTools() {
  if (document.querySelector(".contact-dock")) return;

  const contactTools = document.createElement("div");
  contactTools.className = "contact-tools";
  contactTools.innerHTML = `
    <nav class="contact-dock" aria-label="Liên hệ Flowerflow">
      <a class="contact-dock__link" href="https://www.facebook.com/share/18ArSM1cHN/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer" aria-label="Chat Facebook">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4a9.6 9.6 0 0 0-8.1 14.8L2.7 21l4-1.1A9.6 9.6 0 1 0 12 2.4Z" fill="currentColor"/><path d="m8.2 13.3 2.2-2.3 2.1 1.6 3.3-3.5-2.2 5.2-2.2-1.6-3.2 3.4z" fill="#fff"/></svg>
        <span>Chat Facebook</span>
      </a>
      <a class="contact-dock__link" href="https://zalo.me/g/s7osfsriyfdvdqcfxeac" target="_blank" rel="noopener noreferrer" aria-label="Nhắn tin Zalo">
        <svg class="contact-dock__zalo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor"/><path d="M8 10h15v2L13 21h10v2H8v-2l10-9H8z" fill="#fff"/></svg>
        <span>Nhắn tin Zalo</span>
      </a>
    </nav>
  `;
  document.body.append(contactTools);
})();
