# Face Names

Learn students' names from their faces. Class photos are labeled semi-automatically
(face matching + seating chart), then turned into spaced-repetition flashcards.

## Opening it

Unzip the folder first if it came as a zip, and keep it somewhere permanent. Double-click `index.html` to open it in **Chrome or Edge**. It doesn't need an internet connection:
the face-recognition models and PDF reader come with it.

Or open **https://summersbyu.github.io/face-names/** in any browser, including on a phone. It's the same app
with nothing to unzip, and it updates itself. That site holds only the app: anything you add stays in your
browser, the same as with a double-clicked copy. The two keep separate data, so to switch, save a backup
in one and open it in the other.

All data (names, photos, study history) is stored **only in that browser on this computer**.
Nothing is uploaded anywhere. Use the **Backup** tab to save a copy, and always open the app the
same way (the same browser and the same file location), since the data is tied to it.

## Sharing and moving your data

The **Backup** tab saves two kinds of file:

- **My backup** holds everything, including who you know. Use it to keep a copy or to move to another
  computer: open the app there, click **Open a file**, and choose it. It replaces what's in that browser.
- **Student file** is for colleagues teaching the same students. It holds names, seats, photos, and your photo
  labels, but not your study progress, mix-ups, or study history. Notes are left out unless you tick the box.
  Opening one adds to what's there and keeps the colleague's own progress, so you can send an updated file later.
  Students they already have, by section and name, aren't duplicated, and their own labels aren't overwritten.

Both contain student photos and names, so store and send them as you would other student records.

## On a phone

Open the web address above, then add it to your home screen (iPhone: Safari's Share menu, then **Add to Home
Screen**; Android: Chrome's menu, then **Add to Home screen**). It then opens without a connection. On an iPhone,
Safari can clear a site's data after about a week without use unless it's on the home screen.

A phone suits Meet and Test yourself. Do imports and photo labeling on a computer, then bring the data over: on the
computer, **Save my backup** (untick full class photos for a much smaller file), and on the phone, **Open a file**.
Your phone and computer don't sync, and opening a backup replaces what's there, so move it each time you switch.

## What to prepare

**Easiest start: seating-chart PDFs with photos.** If your charts show each student's headshot,
first and last name, and a group.seat number (like `2.4`), use **Manage → Students → Import seating chart**
and choose all the PDFs at once. Each one asks for a section name, suggested from the chart (e.g. `F26-1`).
Sections appear by name alone, so give each its own name, with the term to keep semesters apart. Using a name
that's already there asks whether to update that section. You get names, groups, seat numbers, and a photo for every
student, and the positions on the chart become the room's seat map for matching class photos.
Students whose chart shows "Picture not available" are listed in the import report; add their photo from
their student card.

**Or: your picture roll (the class photo roll pages).** These bring in names, preferred names, and photos in one step:

1. Make an empty folder, e.g. `Class rolls`.
2. Open a section's class photo roll in Chrome or Edge and scroll to the bottom so every photo loads.
3. Press **Ctrl+S**, choose **Webpage, Complete**, and save into that folder. Repeat for each section.
4. In the app: **Manage → Students → Import picture roll**, and choose the folder. The browser asks
   permission to read the folder's files. The files are read only on your computer and never uploaded.
   Each page asks for a section name (suggested from the page, e.g. `W27-1`).

Students are listed by preferred name ("Allen Rivera"); their legal name ("James Allen Rivera")
is kept so roster and seating-chart files can use either. Importing a page again updates the same
students and replaces their roll photo. If a photo wasn't saved with the page, the import report names
that student; add their photo by hand from their student card.

**The same student in two semesters** (e.g. this fall's chart and next winter's roll) is linked automatically
by name, so they share all their photos and your study progress: learn them this fall and they're already
known in winter, and every class photo you label now adds to their flashcards next semester. The Students list
shows "also F26-2" next to linked students. If a chart and a roll hold the same picture at different
resolutions, only the largest, sharpest copy is kept; class photos are never removed. Open a student to undo a wrong link ("Not the same person") or to
link one by hand after a name change (the closest-looking faces are listed first).

**Under Manage → Sections** you can rename or delete a section. To drop one student from a section, open the
student and click **Drop from section**. Someone also in other sections stays there with their photos and progress;
if it's their only section, their record is removed. Importing that section's chart or roll again brings them back.

Then add groups, seats, and facts with the files below (optional). They update the same students.

**1. Roster CSV**: one row per student, with a header row. Only a name is required:

```
Section,First Name,Last Name,Group,Row,Seat,Hometown,Major
1,Maria,Garcia,A,1,1,"Mesa, AZ",Accounting
```

- `Name` alone, `Last, First`, or separate `First Name`/`Last Name` columns all work.
- Any extra columns (hometown, major, a fun fact) appear on the back of the flashcard.
- Re-importing updates students instead of duplicating them.
- You can put all 6 sections in one file, or import one file per section.

**2. Seating chart** (optional but recommended), either:
- `Row` and `Seat` columns in the roster CSV, or
- a separate CSV per section laid out like the room, one name per cell, blank for empty seats. Use **Import seating
  chart**, the same button as for PDFs; it seats students already in the section and asks which section:
  ```
  Maria Garcia,Sam Lee,,Ana Ruiz,Ben Cho
  Tom Hale,Ivy Park,,Jo Kim,Raj Patel
  ```
  First names or "Maria G" work if they're unique in the section. Which edge is the front doesn't
  matter, as long as the grid matches the room's layout. Aisles can be blank columns.

**3. One photo per student**, if you didn't import roll pages (roster photos are fine). Name each file after the student
(`Maria Garcia.jpg` or `Garcia, Maria.jpg`), or put the file name in a `Photo` column. Files with no match
are listed first so you can pick the student by hand. A photo that duplicates one already there is dropped.
Students without a photo can still be
labeled from class photos; the seating chart suggests who they probably are.

On **Manage → Students**, the search box finds a student in any section by first, last, or legal name. The
seating chart shows your progress: **green = known**, **amber = learning**,
**white = not met yet**. Linked students show the same color in every section.

**4. Class photos.** For a room of 60:
- Ask everyone to look up for a second. Faces looking down at laptops cause most misses.
- Take 2–3 overlapping shots (left, middle, right) from the front, at full resolution, no zoom.
- iPhone: Settings → Camera → Formats → **Most Compatible** (JPEG). The app can't read HEIC.

## Labeling a class photo

Under **Manage → Class Photos**, choose the section and date, then add the photo(s). **Choose the semester the photo
was taken in** (e.g. `F26-1`, not next semester's `1`): only that roster is considered, and sections without
a chart are marked "(no seating chart)". If the faces clearly fit another section, the app says so and offers
to move the photo. It finds every face and suggests a name using three clues:

1. **Face similarity** to that student's existing photos (only students in that section are considered).
2. **Table groups.** Students in a group sit together, so a group with clear matches in the photo pulls in
   its other members, even before the seat map is ready.
3. **Seat position.** From the confident matches, it works out how the photo lines up with the seating
   chart, so a face near Maria's assigned seat (or her group's seats) leans toward Maria. Students who
   swap seats within their group are handled; nobody is ever assigned to two faces.

Box colors: **teal = confident**, **amber = likely**, **orange = unsure**, **gray = no match**,
**green = confirmed**. Start with **Accept confident**, then work through the rest:

| Key | Action |
|---|---|
| Enter | Confirm the suggested name |
| 1–6 | Pick one of the other possibilities |
| / | Search by name (Enter picks the first result) |
| X | Not a student / not a face |
| U | Undo a confirmed label |
| N or → / ← | Next unlabeled face / move between faces |

Each confirmation re-runs the matching for the remaining faces, so suggestions improve as you go.
Every confirmed face becomes another reference photo for future matching **and** a new flashcard image.

## Studying

The **Study** tab has two steps.

Click a student's name on any study screen to view or edit their record, including their photos.

**1. Meet new students** (about 10 per session; adjustable). You can't recall someone you've never seen,
so new people are introduced before you're tested on them:

- **Study a group of ~5**: everyone's photos, name, seat, and facts on one screen. About five is what
  working memory holds at once, and with a seating chart each group is a real table, so you also learn
  who sits together. Say each name aloud and pick one distinctive feature to link to it; both measurably
  help names stick.
- **Quick check**: pick the right name from that group's names, with immediate feedback. Misses come back
  at the end of the check.
- Then the next group, a **mixed round** of everyone (telling them apart), and a **recall round**: say
  the name, reveal, mark Got it / Missed it. Misses repeat a few cards later.
- Your first try in the recall round starts each person's review schedule: misses come back in about
  10 minutes, the rest tomorrow. A short break between Meet sessions helps.

**2. Test yourself** (reviews) shows all of a student's photos at once; recall the name, press Space, and grade yourself
(1 Again, 2 Hard, 3 Good, 4 Easy). It only includes people you've met. Reviews are scheduled by
spaced repetition. Use the section picker to drill the
class you're about to teach. When you miss one, tell it who you thought it was: the two of you will be
shown back-to-back in future sessions until you can tell them apart.

## Files

- `index.html`, `css/`, `js/`: the app (`js/engine.js` has the matching and scheduling logic)
- `tests/engine.test.js`: matching tests (`node tests/engine.test.js`)
- `tests/sample-class.js`: builds a fake 22-student class for trying the app end to end
