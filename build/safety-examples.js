// Fictional people and fictional labels for demonstration. No real brand or person.
// Medicines are written the way people actually say them; the on-device AI understands the vague ones.
export const EXAMPLES = [
  {
    id: 'mei', person: 'Mei, 72', story: 'Takes warfarin after a heart-valve repair, plus “her water pill”. Her daughter bought her a “memory & joint” supplement.',
    medicines: ['Warfarin 5 mg', 'her water pill'], conditions: ['surgery'], reason: 'memory and joint pain',
    products: [{name: 'Memory & Joint Support (fictional)', text:
`Supplement Facts
Serving Size 2 Capsules
Ginkgo biloba leaf extract 120 mg
Turmeric root extract (Curcuma longa) 500 mg
Black pepper extract (BioPerine) 5 mg
Proprietary Wellness Blend 300 mg: Garlic bulb, Ginger root, Ginseng root
Other ingredients: cellulose, rice flour`}],
  },
  {
    id: 'sam', person: 'Sam, 29', story: 'Takes sertraline and the pill. Started an over-the-counter “mood” supplement before exams.',
    medicines: ['Sertraline', 'Birth control pill'], conditions: [], reason: 'mood and stress',
    products: [{name: 'Calm Mood Blend (fictional)', text:
`Supplement Facts
St. John's Wort aerial parts extract (0.3% hypericin) 300 mg
Valerian root 200 mg
Chamomile flower 100 mg
Other ingredients: gelatin, magnesium stearate`}],
  },
  {
    id: 'ray', person: 'Ray, 61', story: 'On metformin and “my cholesterol pill” — can’t remember its name. Wants to “go natural” for cholesterol and energy.',
    medicines: ['Metformin', 'my cholesterol pill', 'Lisinopril'], conditions: ['diabetes'], reason: 'cholesterol and energy',
    products: [
      {name: 'Heart Health Formula (fictional)', text:
`Red Yeast Rice 1200 mg
Green Tea Extract (50% EGCG) 250 mg
Other ingredients: vegetable cellulose`},
      {name: 'Daily Energy (fictional)', text:
`Ginseng root powder 400 mg
Green tea leaf extract 100 mg
Goldenseal root 100 mg`}],
  },
];
