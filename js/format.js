/* Anzeige-Formatierung und Escaping. */

export function typeIcon(type){
  return { start: '🏁', resume: '▶️', pause: '⏸️', stop: '🏁', log: '📍' }[type] || '📍';
}

export function typeLabel(type){
  return { start: 'Start', resume: 'Weiter', pause: 'Pause', stop: 'Ende', log: 'Wegpunkt' }[type] || 'Wegpunkt';
}

export function fmtTime(t){
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(t){
  return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms){
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} Min`;
  return `${Math.floor(min/60)} Std ${min%60} Min`;
}

export function fmtKm(km){
  return (km || 0).toFixed(1).replace('.', ',');
}
