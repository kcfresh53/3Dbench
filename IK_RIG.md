# Procedural IK animation

The rig layers procedural changes over the existing animation: FK pose → hand/foot/chest goals → ordered motion rules → pelvis, spine, limb and look-at solvers. This architecture takes inspiration from Alexander Bereznyak’s [IK Rig: Procedural Pose Animation](https://www.gdcvault.com/play/1023279/IK-Rig-Procedural-Pose); it is not a reproduction of Ubisoft's implementation.

## Workflow

1. In a Generic Model, select a humanoid armature, enter **Animate**, then **Create IK Rig** in the IK Rig panel. Recognized bone names are required; the built-in humanoid generator works directly.
2. Use an existing animation, or **Import Animations** from a GLB. For the supplied Universal Animation Library archives, extract the files under `Unreal-Godot`; choose the `_RM.glb` variants for root motion and automatic contact analysis. ZIP, FBX and Blender files are not accepted by this animation importer.
3. In **Solvers → Body**, adjust **Crouch** (fraction of bind pelvis height). In **Spine**, adjust forward and side lean in degrees. Foot targets remain at their animation/contact locations while the body changes. Neutral values preserve the existing behavior. Extreme poses remain subject to limb reach and bend limits.
4. **Add Motion Rule** creates an offset, oscillation, or attachment to a scene object. Offsets support world, body-facing, and goal-oriented coordinates. Oscillation amplitude uses world axes; phase uses cycles. Attachments use the chosen object's orientation for their offset. Distances use model units. Use Edit to change settings, arrows to change evaluation order, and Remove to delete custom rules. For attachment goals, use Follow animation mode; Handle only goals remain inactive until an animated handle activates them.
5. Rule order matters. Place foot offsets/oscillations before foot locking and ground adaptation when contacts should win. Put a hand attachment last when the prop grip should win. Rule and solver weights blend their effects.
6. Select terrain and **Use selection as ground**, or use a flat floor. The body adapts to leg targets; hand pull optionally lets hand goals influence the pelvis. Foot locking detects stance in root-motion clips. It is disabled for in-place clips by default.
7. Use **Handle** to select an effector's null object and animate its position. Handles take effect over their keyed interval with a configurable fade. **Bake** writes the solved result into the selected animation's bone keyframes; the default disables the rig afterwards to avoid applying it twice. Bake edits the selected animation, so duplicate it first when you want to retain a separate source clip.

Panel edits, rule changes, rig creation/deletion, terrain selection and bake state support Undo/Redo. Settings persist in `.bbmodel` projects. Crouch, lean and rule settings are project-level controls; animate handles or bake separate variants for animation-specific results. Evaluation has no frame-history dependency, so scrubbing backward and baking produce the same pose for a given input.

## Validation

- `npm run test:ik_rig`: solver, retargeting, terrain, contact, procedural style and deterministic rule-stack regressions.
- `npm run test:humanoid`: generated skeleton and mesh regressions.
- `npx tsc --noEmit` and `npm run build-electron`.
- Optional full-library checks: `node tests/tools/validate_ual_ik.mjs /path/to/UAL1_RM.glb /path/to/UAL2_Standard_RM.glb`. Samples five times in each clip and checks finite transforms and unchanged bone lengths with crouch and lean enabled. This does not assert that every extreme action can reach every target.

The animation archives stay outside the repository. The existing small UAL test fixture is used for deterministic contact and retargeting assertions.
