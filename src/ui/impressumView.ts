export function renderImpressumView(container: HTMLElement): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'sv-wrap';

  wrap.innerHTML = `
    <div class="sv-section">
      <div class="imp-title">Impressum</div>
      <p class="sv-desc">Angaben gemäß § 5 TMG</p>

      <div class="imp-block">
        <div class="imp-field-label">Diensteanbieter</div>
        <div class="imp-placeholder">Vorname Nachname</div>
        <div class="imp-placeholder">Straße und Hausnummer</div>
        <div class="imp-placeholder">PLZ Ort</div>
      </div>

      <div class="imp-block">
        <div class="imp-field-label">Kontakt</div>
        <div class="imp-placeholder">E-Mail: vorname.nachname@example.com</div>
      </div>
    </div>

    <div class="sv-section">
      <div class="rp-section-title">Hinweis zum Einsatz künstlicher Intelligenz</div>
      <p class="sv-desc">
        Diese Webanwendung wurde vollständig mithilfe von
        <a class="imp-link" href="https://claude.ai/code" target="_blank" rel="noopener">Claude Code</a>
        (Anthropic PBC) entwickelt. Sämtlicher Quellcode — einschließlich Benutzeroberfläche,
        Berechnungslogik und Datenmodell — wurde durch KI-gestützte Programmierung erstellt.
        Die fachliche Verantwortung für die korrekte Anwendung der DIN EN 12831 sowie die
        Überprüfung der Ergebnisse liegt beim Anwender.
      </p>
    </div>

    <div class="sv-section">
      <div class="rp-section-title">Haftungsausschluss</div>

      <div class="imp-subsection-title">Haftung für Inhalte</div>
      <p class="sv-desc">
        Die Inhalte dieser Webanwendung wurden mit größtmöglicher Sorgfalt erstellt.
        Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte wird jedoch keine Gewähr
        übernommen. Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf
        diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind
        wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
        Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
        Tätigkeit hinweisen.
      </p>
      <p class="sv-desc">
        Die Berechnungsergebnisse dieser Anwendung dienen ausschließlich der Orientierung und
        ersetzen nicht die Prüfung durch einen zugelassenen Fachplaner. Eine Haftung für
        Schäden, die aus der Verwendung der Berechnungsergebnisse entstehen, wird ausgeschlossen.
      </p>

      <div class="imp-subsection-title">Haftung für Links</div>
      <p class="sv-desc">
        Diese Anwendung enthält keine externen Verlinkungen auf Drittanbieter-Webseiten, die
        einer kontinuierlichen inhaltlichen Kontrolle unterliegen. Zum Zeitpunkt der Verlinkung
        waren keine Rechtsverstöße erkennbar.
      </p>
    </div>

    <div class="sv-section">
      <div class="rp-section-title">Urheberrecht</div>
      <p class="sv-desc">
        Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
        dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
        der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen
        Zustimmung des jeweiligen Autors bzw. Erstellers.
      </p>
    </div>

    <div class="sv-section">
      <div class="rp-section-title">Normen und Berechnungsgrundlagen</div>
      <p class="sv-desc">
        Diese Anwendung implementiert die Heizlastberechnung nach
        <strong>DIN EN 12831-1:2017</strong> (Raumheizungsanlagen in Gebäuden –
        Verfahren zur Berechnung der Norm-Heizlast). Die Anwendung erhebt keinen Anspruch auf
        vollständige Normkonformität. Maßgeblich ist stets die aktuelle Fassung der Norm.
      </p>
    </div>
  `;

  container.appendChild(wrap);
}
