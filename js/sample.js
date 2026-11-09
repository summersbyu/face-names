/* Sample class: 20 made-up students with drawn faces, groups, seats, and facts, to try the app without real student
   data. Kept out of name linking, and removed in one click. */

const SAMPLE_SECTION = 'Sample class';
const hasSample = () => [...S.students.values()].some(s => s.sample);

const SAMPLE_PEOPLE = [
  ['Avery Lindqvist', 'Hometown: Duluth, MN', 'Major: Accounting'], ['Mateo Ferreira', 'Hometown: Mesa, AZ', 'Plays the cello'],
  ['Priya Raman', 'Hometown: Edison, NJ', 'Major: Finance'], ['Jonah Whitfield', 'Hometown: Boise, ID', 'Runs cross-country'],
  ['Leilani Kahale', 'Hometown: Hilo, HI', 'Major: Information Systems'], ['Tobias Okafor', 'Hometown: Houston, TX', 'Served a mission in Ghana'],
  ['Sienna Marchetti', 'Hometown: Reno, NV', 'Major: Accounting'], ['Caleb Nakamura', 'Hometown: Sacramento, CA', 'Builds furniture'],
  ['Ingrid Solberg', 'Hometown: Bergen, Norway', 'Major: Economics'], ['Diego Alvarado', 'Hometown: El Paso, TX', 'Plays intramural soccer'],
  ['Hannah Brightwater', 'Hometown: Missoula, MT', 'Major: Accounting'], ['Samuel Adeyemi', 'Hometown: Atlanta, GA', 'Sings in a choir'],
  ['Mei Tanaka', 'Hometown: Portland, OR', 'Major: Marketing'], ['Elias Varga', 'Hometown: Budapest, Hungary', 'Major: Finance'],
  ['Clara Montoya', 'Hometown: Santa Fe, NM', 'Paints murals'], ['Wyatt Calloway', 'Hometown: Cody, WY', 'Major: Accounting'],
  ['Amara Osei', 'Hometown: Columbus, OH', 'Major: Strategy'], ['Felix Hartmann', 'Hometown: Spokane, WA', 'Rock climber'],
  ['Rosa Delgado', 'Hometown: Tucson, AZ', 'Major: Accounting'], ['Noah Kealoha', 'Hometown: Laie, HI', 'Surfs'],
];

// A simple drawn portrait, the same every time for a given student. Two views: one smiling, one not.
function sampleFace(i, view) {
  let seed = i * 9301 + 49297;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pick = list => list[Math.floor(rnd() * list.length)];
  const skin = pick(['#f6d3b3', '#e8b48f', '#c98e66', '#a86b45', '#7a4a2c', '#f1c6a0', '#d9a07a']);
  const hair = pick(['#1d1410', '#3b2417', '#6b4423', '#a36a2f', '#d9b56c', '#8a8a8a', '#2b1b14']);
  const style = Math.floor(rnd() * 5), glasses = rnd() < 0.3, beard = rnd() < 0.25 && style !== 2;
  const bg = pick(['#dbe7f7', '#e7f1dc', '#f6e3d6', '#ebe0f5', '#f9efc7', '#d9eeee']);
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = view ? '#f2f2f2' : bg; g.fillRect(0, 0, 160, 160);
  const shift = view ? 6 : 0;
  g.fillStyle = hair;
  if (style === 2) { g.beginPath(); g.ellipse(80 + shift, 92, 52, 62, 0, 0, Math.PI * 2); g.fill(); }  // long hair behind
  g.fillStyle = skin;
  g.fillRect(66 + shift, 118, 28, 30);                                                                 // neck
  g.beginPath(); g.ellipse(80 + shift, 80, 38, 46, 0, 0, Math.PI * 2); g.fill();                        // face
  g.fillStyle = hair;
  if (style === 0) { g.beginPath(); g.ellipse(80 + shift, 46, 40, 22, 0, Math.PI, 0); g.fill(); }
  if (style === 1) { for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(46 + shift + k * 8.5, 42 + (k % 2) * 4, 11, 0, Math.PI * 2); g.fill(); } }
  if (style === 2) { g.beginPath(); g.ellipse(80 + shift, 44, 42, 20, 0, Math.PI, 0); g.fill(); }
  if (style === 3) { g.beginPath(); g.ellipse(80 + shift, 46, 40, 22, 0, Math.PI, 0); g.fill(); g.beginPath(); g.arc(80 + shift, 22, 13, 0, Math.PI * 2); g.fill(); }
  if (beard) { g.beginPath(); g.ellipse(80 + shift, 112, 30, 16, 0, 0, Math.PI); g.fill(); }
  g.fillStyle = '#222';
  for (const x of [66, 94]) { g.beginPath(); g.arc(x + shift, 78, 3.5, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#222'; g.lineWidth = 2.5;
  for (const x of [66, 94]) { g.beginPath(); g.moveTo(x - 8 + shift, 68); g.lineTo(x + 8 + shift, 66 + (style % 2)); g.stroke(); }
  if (glasses) { g.lineWidth = 2; for (const x of [66, 94]) { g.beginPath(); g.arc(x + shift, 78, 10, 0, Math.PI * 2); g.stroke(); } g.beginPath(); g.moveTo(76 + shift, 78); g.lineTo(84 + shift, 78); g.stroke(); }
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 3;
  g.beginPath();
  if (view) { g.moveTo(68 + shift, 104); g.lineTo(92 + shift, 104); } else g.arc(80 + shift, 98, 12, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  return c.toDataURL('image/jpeg', 0.85);
}

function sampleDesc(i) {
  let seed = i * 7919 + 17;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const d = Array.from({ length: 128 }, rnd), n = Math.hypot(...d);
  return d.map(v => v / n);
}

async function loadSample() {
  if (hasSample()) { toast('The sample class is already here.'); return; }
  const students = SAMPLE_PEOPLE.map(([name, ...facts], i) => ({
    id: uid(), section: SAMPLE_SECTION, term: '', name, notes: facts.join('\n'), sample: true, linkLocked: true,
    group: String(Math.floor(i / 5) + 1), row: Math.floor(i / 5) + 1, seat: (i % 5) + 1, seatLabel: `${Math.floor(i / 5) + 1}.${(i % 5) + 1}`,
  }));
  await saveStudents(students);
  const date = today();
  await saveFaces(students.flatMap((s, i) => [0, 1].map(view => ({ id: uid(), studentId: s.id, status: 'confirmed', kind: 'reference', source: 'sample',
    photoId: null, section: SAMPLE_SECTION, desc: sampleDesc(i * 2 + view), thumb: sampleFace(i, view), date,
    dupChecked: true }))));  // two drawings of one face would look like copies to the duplicate cleanup
  S.section = SAMPLE_SECTION;
  S.studySection = SAMPLE_SECTION;
  goTo('study');
  toast('Sample class added: 20 made-up students. Start with Meet. Remove it anytime from the banner at the top.', 7000);
}

async function removeSample() {
  if (!(await confirmBox('Remove the sample class? Its made-up students and your practice with them are deleted. Your own students aren’t touched.', 'Remove'))) return;
  const secs = [...new Set([...S.students.values()].filter(s => s.sample).map(s => s.section))];
  for (const sec of secs) await deleteSection(sec);
  if (S.studySection && !sections().includes(S.studySection)) S.studySection = '';
  render();
  toast('Sample class removed.');
}

function sampleBanner() {
  if (!hasSample()) return null;
  return h('div', { class: 'tip toolbar' },
    h('span', { class: 'spacer' }, h('b', null, 'Sample class: '), 'made-up students for trying the app. Remove it when you’re ready for your own.'),
    h('button', { onclick: removeSample }, 'Remove sample class'));
}
