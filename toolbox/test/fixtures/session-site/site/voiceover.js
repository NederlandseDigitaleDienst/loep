// The page's own script, loaded from the site: a test page for VoiceOver loads it through <base href>.
document.documentElement.dataset.ownScript = "ran";
const dialog = document.getElementById("feedback");
const thanks = document.getElementById("thanks");
const error = document.getElementById("error");
const complete = () => document.getElementById("kind").value !== "" && document.getElementById("message").value.trim().length >= 4;
const show = (element, text) => {
  element.textContent = text;
  element.hidden = false;
};
document.getElementById("open-feedback").addEventListener("click", () => dialog.showModal());
document.getElementById("feedback-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!complete()) return show(error, "Uw feedback is nog niet verstuurd: kies een soort en schrijf minstens 4 tekens.");
  fetch("/submit", { method: "POST", body: new FormData(event.target) }).then(
    () => show(thanks, "Bedankt voor uw feedback."),
    () => show(error, "Versturen is niet gelukt."),
  );
});
document.getElementById("by-mail").addEventListener("click", () => {
  window.open("mailto:test@example.com?subject=Feedback");
  show(thanks, "Uw e-mailprogramma is geopend.");
});
document.getElementById("by-issue").addEventListener("click", () => {
  const opened = window.open("/elsewhere.html", "_blank");
  show(thanks, opened ? "Bedankt, het nieuwe venster is geopend." : "Het nieuwe venster opende niet.");
});
