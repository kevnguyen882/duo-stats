// Badge art: the champion a badge was earned on, inside that badge's border (web/img/borders/<badge id>.png).
// The borders are 512px with transparent backgrounds, all drawn on one template: the opening is a circle about half the
// width, in the middle. Each has a matching <id>-mask.png of its opening, so the portrait fills it exactly.
//   badgeArt(id, champion, icon) -> HTML for a square that fills its container (icon is shown only when there's no champion)

// where each border's opening sits, as [left, top, width, height] in % of the square
const BADGE_BORDERS = {
  best:        [24.8, 24.61, 50.39, 50.59],
  sixfig:      [23.24, 23.24, 53.52, 53.52],
  untouch:     [24.02, 24.02, 51.76, 51.17],
  everywhere:  [19.14, 18.36, 61.72, 62.5],
  carry:       [24.61, 24.41, 50.78, 50.98],
  spree:       [20.9, 21.09, 58.2, 57.62],
  playmaker:   [25.59, 26.37, 48.83, 47.46],
  marathon:    [23.44, 23.63, 53.12, 52.54],
  lifeline:    [20.9, 21.29, 58.2, 57.23],
  wall:        [21.09, 20.9, 57.62, 57.81],
  crit:        [23.63, 23.63, 52.73, 52.54],
  unstoppable: [24.22, 24.41, 51.56, 51.17],
  midas:       [24.8, 24.61, 50.39, 50.39],
  twins:       [25.2, 25.98, 49.22, 48.44],
  killers:     [22.85, 22.46, 54.3, 54.49],
  penta:       [22.85, 22.85, 54.3, 53.71],
  quadra:      [23.83, 23.83, 52.34, 52.15],
  triple:      [24.41, 24.22, 51.17, 50.39],
};
const BORDER_DIR = '/img/borders/';

function badgeArt(id, champion, icon){
  const box = BADGE_BORDERS[id];
  if(!box)   // no border drawn for this badge yet: a plain ring
    return `<span class="bart bplain">${champion && ddVer ? `<img class="bface" src="${champImage(champion)}" alt="" draggable="false">` : `<span class="bface bnoface">${icon || ''}</span>`}</span>`;
  const [x, y, w, h] = box;
  const face = champion && ddVer
    ? `<img class="bface" src="${champImage(champion)}" alt="" draggable="false" onerror="this.style.visibility='hidden'" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">`
    : `<span class="bface bnoface" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">${icon || ''}</span>`;
  const mask = `url(${BORDER_DIR}${id}-mask.png)`;
  return `<span class="bart"><span class="bhole" style="-webkit-mask-image:${mask};mask-image:${mask}">${face}</span>`
    + `<img class="bborder" src="${BORDER_DIR}${id}.png" alt="" draggable="false"></span>`;
}
