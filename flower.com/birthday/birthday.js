const note = document.querySelector("#note");
const openButton = document.querySelector("#open-note");
const closeButton = document.querySelector("#close-note");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const card = document.querySelector(".card");
const art = document.querySelector(".art");
let frame = 0;

function moveCard(event) {
  if (reducedMotion.matches || window.matchMedia("(hover: none)").matches) return;
  const bounds = card.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    card.style.setProperty("--shine-x", `${x * 100}%`);
    card.style.setProperty("--shine-y", `${y * 100}%`);
    card.style.setProperty("--shine", ".85");
    card.style.transform = `rotateX(${(0.5 - y) * 5}deg) rotateY(${(x - 0.5) * 7}deg) translateY(-3px)`;
    art.style.transform = `translateZ(20px) translate(${(x - .5) * -8}px, ${(y - .5) * -8}px)`;
  });
}

function resetCard() {
  cancelAnimationFrame(frame);
  card.style.removeProperty("transform");
  card.style.setProperty("--shine", "0");
  art.style.removeProperty("transform");
}

card.addEventListener("pointermove", moveCard);
card.addEventListener("pointerleave", resetCard);

function celebrate(event) {
  if (reducedMotion.matches) return;
  const colors = ["#e97c91", "#c9b6e8", "#f6d27d", "#b9ddca", "#f2b7ad"];
  for (let i = 0; i < 44; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.setAttribute("aria-hidden", "true");
    piece.style.left = `${event.clientX ? event.clientX / window.innerWidth * 100 : 50 + Math.random() * 30}vw`;
    piece.style.top = `${event.clientY ? event.clientY / window.innerHeight * 100 : 35}vh`;
    piece.style.backgroundColor = colors[i % colors.length];
    piece.style.borderRadius = i % 2 ? "50%" : "2px";
    piece.style.setProperty("--drift", `${Math.random() * 240 - 120}px`);
    piece.style.setProperty("--depth", `${Math.random() * 320 - 160}px`);
    piece.style.setProperty("--duration", `${2.4 + Math.random() * 1.8}s`);
    document.body.append(piece);
    window.setTimeout(() => piece.remove(), 4600);
  }
}

openButton.addEventListener("click", (event) => {
  note.showModal();
  closeButton.focus();
  celebrate(event);
});
closeButton.addEventListener("click", () => note.close());
note.addEventListener("click", (event) => {
  if (event.target === note) note.close();
});
