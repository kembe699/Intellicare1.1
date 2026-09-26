// Curated common X-Ray / Ultrasound exam catalog for the new Radiology module.
// Prices are reference figures (matching the same real-world scale already in
// use by tenant_gudele's own X-Ray/Ultrasound service list) — a tenant that
// doesn't charge for radiology (e.g. a free-care facility) simply never
// enforces payment on them, same as it already doesn't for any other service.
const radiologyServices = [
  // X-Ray
  { name: 'X-Ray - Chest', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Abdomen (Supine)', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Abdomen (Erect)', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Abdomino-Pelvic', price: 120000, sub: 'X-Ray' },
  { name: 'X-Ray - Pelvis', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Skull', price: 90000, sub: 'X-Ray' },
  { name: 'X-Ray - Cervical Spine', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Thoracic Spine', price: 90000, sub: 'X-Ray' },
  { name: 'X-Ray - Lumbar Spine', price: 90000, sub: 'X-Ray' },
  { name: 'X-Ray - Whole Spine', price: 156000, sub: 'X-Ray' },
  { name: 'X-Ray - Shoulder', price: 60000, sub: 'X-Ray' },
  { name: 'X-Ray - Humerus', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Elbow', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Forearm', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Wrist', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Hand', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Hip', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Femur', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Knee', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Both Knees', price: 120000, sub: 'X-Ray' },
  { name: 'X-Ray - Leg (Tibia/Fibula)', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Ankle', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Foot', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - Paranasal Sinuses', price: 80000, sub: 'X-Ray' },
  { name: 'X-Ray - KUB (Kidney-Ureter-Bladder)', price: 120000, sub: 'X-Ray' },
  // Ultrasound
  { name: 'Ultrasound - Abdominal', price: 100000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Pelvic', price: 100000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Abdomino-Pelvic', price: 120000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Obstetric (Pregnancy)', price: 100000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Transvaginal', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Renal', price: 100000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Thyroid / Neck', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Breast', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Scrotal', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Soft Tissue', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Musculoskeletal (MSK)', price: 150000, sub: 'Ultrasound' },
  { name: 'Ultrasound - Doppler (Vascular)', price: 200000, sub: 'Ultrasound' },
];

module.exports = { radiologyServices };
