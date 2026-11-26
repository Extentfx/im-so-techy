export type Muscle = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';
export interface Exercise {
  id: string;
  name: string;
  muscle: Muscle;
  equipment: 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell';
}

const e = (
  id: string,
  name: string,
  muscle: Muscle,
  equipment: Exercise['equipment'],
): Exercise => ({ id, name, muscle, equipment });

/** A built-in starter library so the tracker works offline and without any outside request. */
export const EXERCISES: readonly Exercise[] = [
  e('back-squat', 'Back squat', 'legs', 'barbell'),
  e('front-squat', 'Front squat', 'legs', 'barbell'),
  e('leg-press', 'Leg press', 'legs', 'machine'),
  e('romanian-deadlift', 'Romanian deadlift', 'legs', 'barbell'),
  e('deadlift', 'Deadlift', 'back', 'barbell'),
  e('walking-lunge', 'Walking lunge', 'legs', 'dumbbell'),
  e('bulgarian-split-squat', 'Bulgarian split squat', 'legs', 'dumbbell'),
  e('leg-curl', 'Leg curl', 'legs', 'machine'),
  e('leg-extension', 'Leg extension', 'legs', 'machine'),
  e('hip-thrust', 'Hip thrust', 'legs', 'barbell'),
  e('calf-raise', 'Standing calf raise', 'legs', 'machine'),
  e('goblet-squat', 'Goblet squat', 'legs', 'kettlebell'),
  e('kettlebell-swing', 'Kettlebell swing', 'legs', 'kettlebell'),
  e('bench-press', 'Bench press', 'chest', 'barbell'),
  e('incline-bench-press', 'Incline bench press', 'chest', 'barbell'),
  e('dumbbell-bench-press', 'Dumbbell bench press', 'chest', 'dumbbell'),
  e('incline-dumbbell-press', 'Incline dumbbell press', 'chest', 'dumbbell'),
  e('chest-fly', 'Chest fly', 'chest', 'cable'),
  e('push-up', 'Push-up', 'chest', 'bodyweight'),
  e('dip', 'Dip', 'chest', 'bodyweight'),
  e('pec-deck', 'Pec deck', 'chest', 'machine'),
  e('barbell-row', 'Barbell row', 'back', 'barbell'),
  e('dumbbell-row', 'Dumbbell row', 'back', 'dumbbell'),
  e('pull-up', 'Pull-up', 'back', 'bodyweight'),
  e('chin-up', 'Chin-up', 'back', 'bodyweight'),
  e('lat-pulldown', 'Lat pulldown', 'back', 'cable'),
  e('seated-cable-row', 'Seated cable row', 'back', 'cable'),
  e('face-pull', 'Face pull', 'shoulders', 'cable'),
  e('t-bar-row', 'T-bar row', 'back', 'barbell'),
  e('overhead-press', 'Overhead press', 'shoulders', 'barbell'),
  e('dumbbell-shoulder-press', 'Dumbbell shoulder press', 'shoulders', 'dumbbell'),
  e('lateral-raise', 'Lateral raise', 'shoulders', 'dumbbell'),
  e('rear-delt-fly', 'Rear delt fly', 'shoulders', 'dumbbell'),
  e('arnold-press', 'Arnold press', 'shoulders', 'dumbbell'),
  e('barbell-curl', 'Barbell curl', 'arms', 'barbell'),
  e('dumbbell-curl', 'Dumbbell curl', 'arms', 'dumbbell'),
  e('hammer-curl', 'Hammer curl', 'arms', 'dumbbell'),
  e('triceps-pushdown', 'Triceps pushdown', 'arms', 'cable'),
  e('skull-crusher', 'Skull crusher', 'arms', 'barbell'),
  e('overhead-triceps-extension', 'Overhead triceps extension', 'arms', 'dumbbell'),
  e('plank', 'Plank', 'core', 'bodyweight'),
  e('hanging-leg-raise', 'Hanging leg raise', 'core', 'bodyweight'),
  e('cable-crunch', 'Cable crunch', 'core', 'cable'),
  e('ab-wheel', 'Ab wheel rollout', 'core', 'bodyweight'),
  e('russian-twist', 'Russian twist', 'core', 'bodyweight'),
];

export const EXERCISE_BY_ID: ReadonlyMap<string, Exercise> = new Map(
  EXERCISES.map((x) => [x.id, x]),
);
