-- =============================================================================
-- SEED 001 — reference data. *** SYNTHETIC DEMONSTRATION DATA ***
-- Fictional organisations, facilities, people and manufacturers. Coordinates
-- are approximate town centres used only to compute plausible distances.
-- Every organisation/facility/user/manufacturer row has is_synthetic = true.
-- =============================================================================

SELECT setseed(0.2026);

-- ---------------------------------------------------------------- regions ----
INSERT INTO regions (code, name) VALUES ('KA', 'Karnataka');
INSERT INTO regions (parent_id, code, name)
SELECT (SELECT id FROM regions WHERE code = 'KA'), v.code, v.name
FROM (VALUES ('KA-BLU', 'Bengaluru Urban'), ('KA-BLR', 'Bengaluru Rural'), ('KA-RMN', 'Ramanagara'),
             ('KA-TMK', 'Tumakuru'), ('KA-MYS', 'Mysuru'), ('KA-CBP', 'Chikkaballapur')) v(code, name);
INSERT INTO regions (parent_id, code, name)
SELECT (SELECT id FROM regions WHERE code = v.district), v.code, v.name
FROM (VALUES ('KA-BLU', 'KA-BLU-N', 'Bengaluru North'), ('KA-BLU', 'KA-BLU-S', 'Bengaluru South'),
             ('KA-BLU', 'KA-BLU-E', 'Bengaluru East'),  ('KA-BLU', 'KA-BLU-A', 'Anekal'),
             ('KA-BLR', 'KA-BLR-H', 'Hoskote'),         ('KA-BLR', 'KA-BLR-D', 'Devanahalli'),
             ('KA-RMN', 'KA-RMN-R', 'Ramanagara'),      ('KA-RMN', 'KA-RMN-M', 'Magadi'),
             ('KA-TMK', 'KA-TMK-T', 'Tumakuru'),        ('KA-MYS', 'KA-MYS-M', 'Mysuru'),
             ('KA-CBP', 'KA-CBP-C', 'Chikkaballapur')) v(district, code, name);

-- ---------------------------------------------------------- organisations ----
INSERT INTO organizations (name, org_type, registration_number, contact_email) VALUES
    ('Deccan Public Health Network (Synthetic)',        'PUBLIC_HEALTH_AUTHORITY', 'SYN-ORG-0001', 'ops@deccan-phn.example'),
    ('Kaveri Hospitals Trust (Synthetic)',              'HOSPITAL_NETWORK',        'SYN-ORG-0002', 'pharmacy@kaveri-trust.example'),
    ('Namma Pharmacy Cooperative (Synthetic)',          'PHARMACY_CHAIN',          'SYN-ORG-0003', 'stock@namma-coop.example'),
    ('Southern Medical Supplies Depot (Synthetic)',     'MEDICAL_WAREHOUSE',       'SYN-ORG-0004', 'dispatch@southern-depot.example'),
    ('Arogya Community Health Foundation (Synthetic)',  'NGO',                     'SYN-ORG-0005', 'care@arogya-foundation.example');

-- ------------------------------------------------------------- facilities ----
INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude,
                        has_cold_chain, max_dispatch_radius_km, contact_phone)
SELECT o.id, r.id, v.code, v.name, v.ftype::facility_type, v.addr, v.lat, v.lng, v.cold, v.radius, v.phone
FROM (VALUES
    ('SYN-ORG-0001', 'KA-BLU-N', 'FAC-001', 'Bengaluru Central District Hospital', 'HOSPITAL',                '1 Hospital Road',      12.971600, 77.594600, true,  120, '+91 80 2000 0001'),
    ('SYN-ORG-0001', 'KA-BLU-N', 'FAC-002', 'Yelahanka Community Health Centre',   'COMMUNITY_HEALTH_CENTRE', '14 Station Road',      13.100700, 77.596300, true,   80, '+91 80 2000 0002'),
    ('SYN-ORG-0001', 'KA-BLR-H', 'FAC-003', 'Hoskote Primary Health Centre',       'PRIMARY_HEALTH_CENTRE',   '3 Market Road',        13.070700, 77.798200, false,  60, '+91 80 2000 0003'),
    ('SYN-ORG-0001', 'KA-RMN-R', 'FAC-004', 'Ramanagara District Hospital',        'HOSPITAL',                '7 B M Road',           12.715900, 77.281000, true,  100, '+91 80 2000 0004'),
    ('SYN-ORG-0001', 'KA-RMN-M', 'FAC-005', 'Magadi Primary Health Centre',        'PRIMARY_HEALTH_CENTRE',   '22 Fort Road',         12.957900, 77.224000, false,  60, '+91 80 2000 0005'),
    ('SYN-ORG-0002', 'KA-BLU-S', 'FAC-006', 'Kaveri General Hospital Jayanagar',   'HOSPITAL',                '9 Ninth Block',        12.925000, 77.593800, true,  100, '+91 80 2000 0006'),
    ('SYN-ORG-0002', 'KA-MYS-M', 'FAC-007', 'Kaveri Hospital Mysuru',              'HOSPITAL',                '45 Sayyaji Rao Road',  12.295800, 76.639400, true,  180, '+91 821 200 0007'),
    ('SYN-ORG-0002', 'KA-BLU-E', 'FAC-008', 'Kaveri Clinic Whitefield',            'COMMUNITY_HEALTH_CENTRE', '18 ITPL Main Road',    12.969800, 77.750000, true,   80, '+91 80 2000 0008'),
    ('SYN-ORG-0003', 'KA-BLU-N', 'FAC-009', 'Namma Pharmacy Malleshwaram',         'PHARMACY',                '5 Sampige Road',       13.003500, 77.570000, true,   50, '+91 80 2000 0009'),
    ('SYN-ORG-0003', 'KA-TMK-T', 'FAC-010', 'Namma Pharmacy Tumakuru',             'PHARMACY',                '11 B H Road',          13.339200, 77.114000, true,   80, '+91 816 200 0010'),
    ('SYN-ORG-0003', 'KA-BLU-A', 'FAC-011', 'Namma Pharmacy Electronic City',      'PHARMACY',                '2 Hosur Road',         12.845200, 77.660200, false,  50, '+91 80 2000 0011'),
    ('SYN-ORG-0004', 'KA-BLU-N', 'FAC-012', 'Southern Depot Peenya',               'WAREHOUSE',               '31 Industrial Area',   13.028500, 77.519700, true,  200, '+91 80 2000 0012'),
    ('SYN-ORG-0004', 'KA-MYS-M', 'FAC-013', 'Southern Depot Mysuru',               'WAREHOUSE',               '8 Hebbal Industrial',  12.337500, 76.619400, true,  200, '+91 821 200 0013'),
    ('SYN-ORG-0005', 'KA-CBP-C', 'FAC-014', 'Arogya CHC Chikkaballapur',           'COMMUNITY_HEALTH_CENTRE', '6 Bengaluru Road',     13.435500, 77.731500, true,   90, '+91 815 200 0014'),
    ('SYN-ORG-0005', 'KA-BLR-D', 'FAC-015', 'Arogya PHC Devanahalli',              'PRIMARY_HEALTH_CENTRE',   '4 Fort Street',        13.247300, 77.712000, false,  60, '+91 80 2000 0015')
) v(org, region, code, name, ftype, addr, lat, lng, cold, radius, phone)
JOIN organizations o ON o.registration_number = v.org
JOIN regions r ON r.code = v.region;

-- -------------------------------------------------------------- users --------
-- Every synthetic account uses the demo password  MedShare@2026  (bcrypt).
DO $$
DECLARE
    v_hash  text := crypt('MedShare@2026', gen_salt('bf', 10));
    v_first text[] := ARRAY['Asha','Vikram','Meera','Rohit','Divya','Kiran','Anil','Pooja','Suresh','Lakshmi','Arjun','Nandini',
                            'Ravi','Sneha','Imran','Kavya','Prakash','Farah','Manoj','Deepa','Naveen','Shruti','Ganesh','Ayesha',
                            'Sanjay','Rekha','Harish','Bhavana','Tejas','Ritu','Mohan','Anjali','Varun','Geetha','Karthik'];
    v_last  text[] := ARRAY['Raman','Shetty','Iyer','Kulkarni','Prasad','Joshi','Bhat','Reddy','Gowda','Devi','Menon','Hegde',
                            'Kumar','Patil','Sheikh','Nair','Rao','Khan','Murthy','Acharya'];
    i       integer := 0;
    f       record;
    o       record;
    u       bigint;
    v_name  text;
BEGIN
    INSERT INTO users (email, password_hash, full_name, is_synthetic) VALUES
        ('admin@medshare.health',   v_hash, 'Asha Raman (Synthetic)',     true),
        ('auditor@medshare.health', v_hash, 'Farhan Siddiqui (Synthetic)', true);
    INSERT INTO user_roles (user_id, role_id, organization_id)
    SELECT u.id, r.id, NULL::integer FROM users u, roles r WHERE u.email = 'admin@medshare.health' AND r.code = 'SYSTEM_ADMIN'
    UNION ALL
    SELECT u.id, r.id, NULL::integer FROM users u, roles r WHERE u.email = 'auditor@medshare.health' AND r.code = 'AUDITOR';

    FOR o IN SELECT * FROM organizations ORDER BY id LOOP
        i := i + 1;
        v_name := v_first[1 + (i * 7) % array_length(v_first, 1)] || ' ' || v_last[1 + (i * 3) % array_length(v_last, 1)];
        INSERT INTO users (email, password_hash, full_name, is_synthetic)
        VALUES (format('org%s.admin@medshare.health', ltrim(substr(o.registration_number, 9), '0')), v_hash, v_name || ' (Synthetic)', true)
        RETURNING id INTO u;
        INSERT INTO user_roles (user_id, role_id, organization_id) SELECT u, id, o.id FROM roles WHERE code = 'ORG_ADMIN';
    END LOOP;

    -- An organisation-scoped auditor (sees only Kaveri Hospitals Trust).
    INSERT INTO users (email, password_hash, full_name, is_synthetic)
    VALUES ('org2.auditor@medshare.health', v_hash, 'Bhavana Acharya (Synthetic)', true) RETURNING id INTO u;
    INSERT INTO user_roles (user_id, role_id, organization_id)
    SELECT u, r.id, o2.id FROM roles r, organizations o2 WHERE r.code = 'AUDITOR' AND o2.registration_number = 'SYN-ORG-0002';

    FOR f IN SELECT * FROM facilities ORDER BY id LOOP
        i := i + 1;
        v_name := v_first[1 + (i * 5) % array_length(v_first, 1)] || ' ' || v_last[1 + (i * 7) % array_length(v_last, 1)];
        INSERT INTO users (email, password_hash, full_name, is_synthetic)
        VALUES (lower(f.code) || '.manager@medshare.health', v_hash, v_name || ' (Synthetic)', true) RETURNING id INTO u;
        INSERT INTO facility_users (user_id, facility_id, role_id) SELECT u, f.id, id FROM roles WHERE code = 'FACILITY_MANAGER';

        i := i + 1;
        v_name := v_first[1 + (i * 5) % array_length(v_first, 1)] || ' ' || v_last[1 + (i * 11) % array_length(v_last, 1)];
        INSERT INTO users (email, password_hash, full_name, is_synthetic)
        VALUES (lower(f.code) || '.inventory@medshare.health', v_hash, v_name || ' (Synthetic)', true) RETURNING id INTO u;
        INSERT INTO facility_users (user_id, facility_id, role_id) SELECT u, f.id, id FROM roles WHERE code = 'INVENTORY_MANAGER';
    END LOOP;
END $$;

-- Transfer agreements (canonical a < b). Org 2 ↔ Org 3 lapsed — demonstrates expiry.
INSERT INTO organization_agreements (organization_a_id, organization_b_id, valid_from, valid_to, created_by)
SELECT least(oa.id, ob.id), greatest(oa.id, ob.id), current_date - v.vf,
       CASE WHEN v.vt IS NULL THEN NULL ELSE current_date - v.vt END,
       (SELECT id FROM users WHERE email = 'admin@medshare.health')
FROM (VALUES ('SYN-ORG-0001', 'SYN-ORG-0004', 400, NULL), ('SYN-ORG-0002', 'SYN-ORG-0004', 400, NULL),
             ('SYN-ORG-0003', 'SYN-ORG-0004', 400, NULL), ('SYN-ORG-0001', 'SYN-ORG-0005', 300, NULL),
             ('SYN-ORG-0004', 'SYN-ORG-0005', 300, NULL), ('SYN-ORG-0002', 'SYN-ORG-0003', 500, 30)) v(a, b, vf, vt)
JOIN organizations oa ON oa.registration_number = v.a
JOIN organizations ob ON ob.registration_number = v.b;

-- ------------------------------------------------------- catalogue: lookups --
INSERT INTO medicine_units (code, name) VALUES
    ('TAB', 'tablet'), ('CAP', 'capsule'), ('VIAL', 'vial'), ('AMP', 'ampoule'), ('BTL', 'bottle'),
    ('INH', 'inhaler'), ('SACHET', 'sachet'), ('TUBE', 'tube');

INSERT INTO medicine_categories (name, description) VALUES
    ('Anti-infectives', NULL), ('Cardiovascular', NULL), ('Endocrine & metabolic', NULL), ('Analgesics & anti-inflammatory', NULL),
    ('Respiratory', NULL), ('Gastrointestinal', NULL), ('Fluids & electrolytes', NULL), ('Vitamins & minerals', NULL),
    ('Maternal health', NULL), ('Central nervous system', NULL), ('Vaccines', 'Cold-chain biologicals'), ('Dermatological', NULL);
INSERT INTO medicine_categories (parent_id, name)
SELECT (SELECT id FROM medicine_categories WHERE name = v.parent AND parent_id IS NULL), v.name
FROM (VALUES ('Anti-infectives', 'Antibiotics'), ('Anti-infectives', 'Antimalarials'), ('Anti-infectives', 'Anthelmintics'),
             ('Cardiovascular', 'Antihypertensives'), ('Cardiovascular', 'Lipid-lowering agents'),
             ('Cardiovascular', 'Antiplatelets & anticoagulants'),
             ('Endocrine & metabolic', 'Antidiabetics'), ('Endocrine & metabolic', 'Corticosteroids'),
             ('Central nervous system', 'Antiepileptics')) v(parent, name);

INSERT INTO manufacturers (name, license_number) VALUES
    ('Deccan Generics Ltd (Synthetic)',        'SYN-KA-MFG-1001'),
    ('Sahyadri Pharmaceuticals (Synthetic)',   'SYN-KA-MFG-1002'),
    ('Kaveri Lifesciences (Synthetic)',        'SYN-KA-MFG-1003'),
    ('Malnad Formulations (Synthetic)',        'SYN-KA-MFG-1004'),
    ('Tunga Biologicals (Synthetic)',          'SYN-KA-MFG-1005'),
    ('Coromandel Healthcare (Synthetic)',      'SYN-TN-MFG-1006');

-- ------------------------------------------------------ catalogue: medicines --
-- ingredients: 'Substance:value:uom|…' · daily = units/day at a reference-size facility · cost in ₹/unit
CREATE TEMP TABLE _seed_medicines (
    n integer, name text, form dosage_form, volume numeric, category text, unit text, cold boolean, essential boolean,
    ingredients text, daily numeric, cost numeric
) ON COMMIT DROP;

INSERT INTO _seed_medicines VALUES
 ( 1,'Paracetamol','TABLET',NULL,'Analgesics & anti-inflammatory','TAB',false,true,'Paracetamol:500:mg',120,0.6),
 ( 2,'Paracetamol','SUSPENSION',60,'Analgesics & anti-inflammatory','BTL',false,true,'Paracetamol:120:mg/5mL',8,22),
 ( 3,'Ibuprofen','TABLET',NULL,'Analgesics & anti-inflammatory','TAB',false,true,'Ibuprofen:400:mg',45,0.9),
 ( 4,'Diclofenac','INJECTION',3,'Analgesics & anti-inflammatory','AMP',false,false,'Diclofenac sodium:25:mg/mL',6,7),
 ( 5,'Aspirin','TABLET',NULL,'Antiplatelets & anticoagulants','TAB',false,true,'Acetylsalicylic acid:75:mg',60,0.3),
 ( 6,'Aspirin','TABLET',NULL,'Analgesics & anti-inflammatory','TAB',false,false,'Acetylsalicylic acid:300:mg',20,0.4),
 ( 7,'Amoxicillin','CAPSULE',NULL,'Antibiotics','CAP',false,true,'Amoxicillin:500:mg',70,2.1),
 ( 8,'Amoxicillin','SUSPENSION',60,'Antibiotics','BTL',false,true,'Amoxicillin:125:mg/5mL',10,35),
 ( 9,'Amoxicillin + Clavulanic acid','TABLET',NULL,'Antibiotics','TAB',false,true,'Amoxicillin:500:mg|Clavulanic acid:125:mg',30,9),
 (10,'Azithromycin','TABLET',NULL,'Antibiotics','TAB',false,true,'Azithromycin:500:mg',18,6),
 (11,'Ceftriaxone','INJECTION',NULL,'Antibiotics','VIAL',false,true,'Ceftriaxone:1:g',10,38),
 (12,'Ciprofloxacin','TABLET',NULL,'Antibiotics','TAB',false,true,'Ciprofloxacin:500:mg',22,2.5),
 (13,'Metronidazole','TABLET',NULL,'Antibiotics','TAB',false,true,'Metronidazole:400:mg',25,0.8),
 (14,'Doxycycline','CAPSULE',NULL,'Antibiotics','CAP',false,true,'Doxycycline:100:mg',15,1.8),
 (15,'Co-trimoxazole','TABLET',NULL,'Antibiotics','TAB',false,true,'Sulfamethoxazole:400:mg|Trimethoprim:80:mg',20,1.1),
 (16,'Artemether + Lumefantrine','TABLET',NULL,'Antimalarials','TAB',false,true,'Artemether:20:mg|Lumefantrine:120:mg',6,8),
 (17,'Chloroquine','TABLET',NULL,'Antimalarials','TAB',false,true,'Chloroquine phosphate:250:mg',4,1.2),
 (18,'Albendazole','TABLET',NULL,'Anthelmintics','TAB',false,true,'Albendazole:400:mg',14,3),
 (19,'Metformin','TABLET',NULL,'Antidiabetics','TAB',false,true,'Metformin hydrochloride:500:mg',150,0.5),
 (20,'Glimepiride','TABLET',NULL,'Antidiabetics','TAB',false,true,'Glimepiride:2:mg',40,1.4),
 (21,'Insulin, soluble (human)','INJECTION',10,'Antidiabetics','VIAL',true,true,'Insulin human:40:IU/mL',4,160),
 (22,'Insulin, isophane (human)','INJECTION',10,'Antidiabetics','VIAL',true,true,'Insulin isophane human:40:IU/mL',3,170),
 (23,'Amlodipine','TABLET',NULL,'Antihypertensives','TAB',false,true,'Amlodipine:5:mg',100,0.4),
 (24,'Losartan','TABLET',NULL,'Antihypertensives','TAB',false,true,'Losartan potassium:50:mg',50,1.6),
 (25,'Atenolol','TABLET',NULL,'Antihypertensives','TAB',false,true,'Atenolol:50:mg',35,0.7),
 (26,'Atorvastatin','TABLET',NULL,'Lipid-lowering agents','TAB',false,true,'Atorvastatin:10:mg',55,1.9),
 (27,'Enalapril','TABLET',NULL,'Antihypertensives','TAB',false,true,'Enalapril maleate:5:mg',28,0.9),
 (28,'Hydrochlorothiazide','TABLET',NULL,'Antihypertensives','TAB',false,true,'Hydrochlorothiazide:12.5:mg',25,0.5),
 (29,'Clopidogrel','TABLET',NULL,'Antiplatelets & anticoagulants','TAB',false,true,'Clopidogrel:75:mg',20,2.2),
 (30,'Heparin','INJECTION',5,'Antiplatelets & anticoagulants','VIAL',false,true,'Heparin sodium:5000:IU/mL',2.5,95),
 (31,'Salbutamol','INHALER',NULL,'Respiratory','INH',false,true,'Salbutamol:100:mcg/dose',4,140),
 (32,'Budesonide','INHALER',NULL,'Respiratory','INH',false,false,'Budesonide:200:mcg/dose',2,320),
 (33,'Prednisolone','TABLET',NULL,'Corticosteroids','TAB',false,true,'Prednisolone:5:mg',20,0.6),
 (34,'Omeprazole','CAPSULE',NULL,'Gastrointestinal','CAP',false,true,'Omeprazole:20:mg',60,0.9),
 (35,'Ondansetron','TABLET',NULL,'Gastrointestinal','TAB',false,true,'Ondansetron:4:mg',15,2.4),
 (36,'Oral Rehydration Salts','SACHET',NULL,'Fluids & electrolytes','SACHET',false,true,
     'Sodium chloride:2.6:g|Glucose:13.5:g|Potassium chloride:1.5:g|Trisodium citrate:2.9:g',45,5),
 (37,'Zinc sulphate','TABLET',NULL,'Vitamins & minerals','TAB',false,true,'Zinc sulphate:20:mg',25,0.7),
 (38,'Sodium chloride 0.9%','INFUSION',500,'Fluids & electrolytes','BTL',false,true,'Sodium chloride:0.9:%',16,28),
 (39,'Compound sodium lactate (Ringer''s lactate)','INFUSION',500,'Fluids & electrolytes','BTL',false,true,
     'Sodium chloride:6:g/L|Sodium lactate:3.1:g/L|Potassium chloride:0.4:g/L|Calcium chloride:0.27:g/L',12,34),
 (40,'Glucose 5%','INFUSION',500,'Fluids & electrolytes','BTL',false,true,'Glucose:5:%',10,30),
 (41,'Oxytocin','INJECTION',1,'Maternal health','AMP',true,true,'Oxytocin:5:IU/mL',4,18),
 (42,'Magnesium sulphate','INJECTION',2,'Maternal health','AMP',false,true,'Magnesium sulphate:500:mg/mL',2,22),
 (43,'Ferrous sulphate + Folic acid','TABLET',NULL,'Vitamins & minerals','TAB',false,true,'Ferrous sulphate:100:mg|Folic acid:0.5:mg',160,0.3),
 (44,'Folic acid','TABLET',NULL,'Vitamins & minerals','TAB',false,true,'Folic acid:5:mg',30,0.2),
 (45,'Calcium carbonate + Cholecalciferol','TABLET',NULL,'Vitamins & minerals','TAB',false,false,'Calcium carbonate:500:mg|Cholecalciferol:250:IU',60,1.1),
 (46,'Phenytoin','TABLET',NULL,'Antiepileptics','TAB',false,true,'Phenytoin sodium:100:mg',10,0.9),
 (47,'Levetiracetam','TABLET',NULL,'Antiepileptics','TAB',false,true,'Levetiracetam:500:mg',8,6),
 (48,'Hepatitis B vaccine','INJECTION',1,'Vaccines','VIAL',true,true,'Hepatitis B surface antigen:20:mcg/dose',3,85),
 (49,'Tetanus toxoid','INJECTION',0.5,'Vaccines','AMP',true,true,'Tetanus toxoid:40:IU',4,12),
 (50,'Silver sulfadiazine','CREAM',NULL,'Dermatological','TUBE',false,true,'Silver sulfadiazine:1:%',2,45);

INSERT INTO substances (name)
SELECT DISTINCT split_part(part, ':', 1)
FROM _seed_medicines, unnest(string_to_array(ingredients, '|')) AS part
ORDER BY 1;

INSERT INTO medicines (code, name, dosage_form, unit_volume_ml, category_id, dispensing_unit_id, requires_cold_chain, is_essential, description)
SELECT 'MED-' || lpad(s.n::text, 4, '0'), s.name, s.form, s.volume,
       (SELECT id FROM medicine_categories WHERE name = s.category), (SELECT id FROM medicine_units WHERE code = s.unit),
       s.cold, s.essential, 'Synthetic catalogue entry for demonstration.'
FROM _seed_medicines s ORDER BY s.n;

INSERT INTO medicine_ingredients (medicine_id, substance_id, strength_value, strength_uom)
SELECT m.id, sub.id, split_part(part, ':', 2)::numeric, split_part(part, ':', 3)
FROM _seed_medicines s
JOIN medicines m ON m.code = 'MED-' || lpad(s.n::text, 4, '0')
CROSS JOIN LATERAL unnest(string_to_array(s.ingredients, '|')) AS part
JOIN substances sub ON sub.name = split_part(part, ':', 1);

-- Keep the per-medicine simulation parameters for the activity seed.
CREATE TABLE _seed_params AS
SELECT m.id AS medicine_id, s.daily, s.cost, s.cold, s.form FROM _seed_medicines s JOIN medicines m ON m.code = 'MED-' || lpad(s.n::text, 4, '0');
