import {ULTIMATES,ultimateDefinition} from '../arena/ultimate-system.mjs';

export const ultimateChoiceOptions = Object.freeze([
  Object.freeze({ id: 'auto', name: 'Surprise me' }),
  ...ULTIMATES.map(({id,name}) => Object.freeze({id,name})),
]);

export function ultimateChoicePresentation(choice = 'auto') {
  if (choice === 'auto') return { name: 'Surprise me', detail: 'The yard picks your spell for this match. A no-combat plan gets a healing or shield spell.' };
  const {name,detail} = ultimateDefinition(choice);
  return {name,detail};
}

// Artwork metadata supplies the face, never the fighter's chosen identity.
export function fighterPresentation(fighter, seat, color) {
  return { ...fighter.avatar, ...fighter, id: seat, color };
}
