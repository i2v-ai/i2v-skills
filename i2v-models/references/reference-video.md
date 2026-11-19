# Reference image to video

1. Identify the role of each reference: exact opening frame, exact closing frame, a visual reference, or a video or audio source. Preserve the user's role. For the standard video API, the documented `urls` slot supplies ordered keyframes, while `referenceImageUrls` supplies visual references.
2. Ask for a target duration and aspect ratio when the output depends on them. Use one strong camera motion and one subject action in a short clip. Specify continuity of face, wardrobe, background and lighting where needed. Keep an exact closing frame when the shot is meant to transition to another clip.
3. Verify the model's task modes and live schema, including frame slots and audio generation. Use only approved files and URLs. Preflight with actual references and costs, then submit within the approved USD limit.
4. Keep the original task ID. On completion, check the opening and closing poses, continuity, crop, duration and audio. Flag items you could not inspect. Use the existing task ID to save or recover the clip.
