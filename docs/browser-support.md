# Browser qualification

The 0.1.0a alpha candidate was tested on Linux Mint 22.3 with Playwright 1.63.0, Node.js 22.23.2 and npm 10.9.8 against fixed production artifacts. Browser versions below are actual executable versions, not just configured browser names.

| Browser | Version | Qualified local scope |
| --- | --- | --- |
| Chromium | 153.0.8010.12 | All 107 retained journeys, plus all 8 release journeys |
| Firefox | 155.0 | 35 relevant retained journeys, plus all 8 release journeys |
| WebKit | 26.6 | 35 relevant retained journeys, plus all 8 release journeys |

The selected retained Firefox/WebKit suites cover painting/palette editing, relocated offline HTML, workspace layout and creator usability. Separate earlier native rendering/resource and sampled-sheet qualifications remain scoped to those increments. The release journeys cover character and nonhuman creation/editing, rig/artwork acceptance, animation/undo, source download/reopen, sampled output with an independent consumer, help/focus, unavailable storage and invalid inputs, practical sizes, strict project-path refresh/examples and exact offline downloads. Assertions corrected during qualification were rerun; no required local failures remain.

Layouts include 1366×768, 1357×592, 1024×768, 800×768 and basic 390px navigation. A 683×384 viewport checks reflow corresponding to an effective 200% desktop viewport; browser-toolbar zoom and phone authoring are not separately qualified. Painting/rectangle selection requires a pointer. Numeric rig/key alternatives and native keyboard navigation are available.

The editor uses Canvas2D. Optional built-runtime demos use WebGL2 first and Canvas2D as backup. Native pixel/matrix/source/resource assertions exercise both. Headless GPU results do not establish hardware-driver support. Full retained Firefox/WebKit coverage, other operating systems, mobile authoring and arbitrary browser versions are not qualified.

Remote Actions and downloaded release hashes require publication verification; local browser tests alone do not establish them. HTTPS Pages, the private security reporting channel and the live Space Lab provider remain pending/unverified. No external human tutorial acceptance is claimed.
