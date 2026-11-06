// Native skills/talents act on operators only. Economy, garrisons and roster counts
// continue to use kind === 'op'.
export const nativeOperator = u => !!u && u.kind === 'op';
