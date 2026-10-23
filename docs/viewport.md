# Rig viewport editing

Open a project or the classic astronaut example, then choose **Rig**. The same tools appear in **All tools**. Circles mark nodes, diamonds mark cosmetic sockets, and squares mark artwork attachment pivots. Click a joint, a bone segment or artwork to select it in the existing item controls. At overlapping pivots, the current selection wins; **Alt-click** cycles candidates in stable compiled order. Numeric selectors also reach coincident and zero-length items across multiple roots/rigs, including scene attachments with no bones.

Choose the edit mode in the Rig inspector:

- **Rest** edits the base local transform. Show rest pose before dragging. Descendants follow a normal transform edit.
- **Pose** writes one absolute local transform key to the selected, shown clip at its effective fractional-second time. Rest stays unchanged. Sockets have no animation tracks and use Rest.

Choose a viewport tool:

- **Move transform**: drag a joint or attachment pivot, or its artwork, to translate in its parent frame.
- **Rotate local transform**: select an item, then drag the circular handle to the right of its pivot. Angles accumulate in CCW radians in the local parent frame; reflections can reverse the apparent world direction.
- **Move rest joint**: move a node while preserving its direct children, sockets and attachments at their rest world positions. This uses the existing joint operation, which also shifts affected key translations. It is distinct from moving the rest transform.

A completed changed drag is one shared Undo step; Redo restores exact editable source. **Escape**, lost capture, pointer cancellation, window blur, changing tasks/selection/focus, opening a file, resizing or closing cancel an unfinished gesture. Releasing a captured pointer completes the drag, including outside the canvas. Preview framing stays fixed during a gesture. Source replacement makes old callbacks inert. File retention still requires keeping your downloaded source.

With the canvas focused, **Ctrl/Cmd Z** undoes and **Ctrl/Cmd Shift Z** redoes. With a Move tool selected, arrow keys move one CSS pixel in screen space; Shift moves ten. Each key press is one source transaction. Text inputs keep native editing/undo. Tab reaches the canvas and the existing numeric controls.

The preview can show solved visual constraints, but viewport pose gestures start from the **raw authored clip**, before constraints. They never bake solved rotations, composition or constraint output into keys. Constraints can keep the displayed pose away from an authored drag; turn off **Apply visual constraints in preview** under **Structure, joints & constraints** to inspect raw FK. The numeric Pose fields continue to show the displayed evaluated local pose. Existing key curves, turns, discrete/cel tracks, unrelated source and accepted artwork revisions remain intact.

Coordinates are x-right/y-up project units, CCW radians and seconds. Hit targets and handles use CSS pixels; backing pixels, zoom, view centre, letterboxing and optional cosmetic placement are accounted for. Translation inverts the complete parent affine, including reflected, rotated, nonuniform and sheared ancestry. Rotation changes local TRS without decomposing a world matrix. Negative and zero own scales remain valid. A singular parent/placement cannot be inverted; the viewport gives a diagnostic and retains source, while numeric local controls remain available. Moving a singular rest joint while preserving children can likewise be refused. Parenting/deletion use the existing explicit preserve modes and structural reviews.

Artwork canvases are reused across transform edits when their source is unchanged. Playback retains its pose/overlay buffers and never compiles on animation frames. Input events validate whole source and recompile changed transforms; these authoring costs are separate from runtime sampling. This viewport adds no runtime dependency or source-format migration.
