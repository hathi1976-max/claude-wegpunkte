/* Minimaler Testrunner – bewusst ohne Abhaengigkeiten, damit die Tests ohne
   Installation im Browser laufen (node ist auf dem Zielrechner nicht vorhanden). */

const faelle = [];
let aktuelleGruppe = '(ohne Gruppe)';

export function gruppe(name, fn){
  const vorher = aktuelleGruppe;
  aktuelleGruppe = name;
  fn();
  aktuelleGruppe = vorher;
}

export function test(name, fn){
  faelle.push({ gruppe: aktuelleGruppe, name, fn });
}

export function gleich(ist, soll, hinweis){
  if (!Object.is(ist, soll)){
    throw new Error(`${hinweis ? hinweis + ': ' : ''}erwartet ${JSON.stringify(soll)}, war ${JSON.stringify(ist)}`);
  }
}

export function nahe(ist, soll, toleranz, hinweis){
  if (Math.abs(ist - soll) > toleranz){
    throw new Error(`${hinweis ? hinweis + ': ' : ''}erwartet ${soll} ±${toleranz}, war ${ist}`);
  }
}

export function tiefGleich(ist, soll, hinweis){
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b){
    throw new Error(`${hinweis ? hinweis + ': ' : ''}\n  erwartet ${b}\n  war      ${a}`);
  }
}

export function wahr(bedingung, hinweis){
  if (!bedingung) throw new Error(hinweis || 'Bedingung nicht erfuellt');
}

export function wirft(fn, hinweis){
  let geworfen = false;
  try { fn(); } catch { geworfen = true; }
  if (!geworfen) throw new Error(hinweis || 'Es wurde keine Ausnahme geworfen');
}

export async function laufeAlle(ausgabe){
  let ok = 0;
  const fehler = [];
  for (const f of faelle){
    try {
      await f.fn();
      ok++;
      ausgabe?.(`  ok   ${f.gruppe} › ${f.name}`, true);
    } catch (e){
      fehler.push({ ...f, e });
      ausgabe?.(`  FEHL ${f.gruppe} › ${f.name}\n       ${e.message}`, false);
    }
  }
  const ergebnis = { gesamt: faelle.length, ok, fehlgeschlagen: fehler.length, fehler };
  ausgabe?.(`\n${ok}/${faelle.length} Tests bestanden`, fehler.length === 0);
  return ergebnis;
}
