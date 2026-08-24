"""Demo catalog: Rohtak + Chandigarh pharmacies and multi-brand salt groups."""

from __future__ import annotations

from datetime import timedelta

# name, brand, strength, form, salt_group, cold_chain, prescription_required
MEDICINES = [
    # Insulin / diabetes
    ("Insulin Glargine", "Lantus SoloStar", "100 IU/ml · 3 ml", "pen", "insulin_glargine", 1, 1),
    ("Insulin Glargine", "Basaglar KwikPen", "100 IU/ml · 3 ml", "pen", "insulin_glargine", 1, 1),
    ("Insulin Glargine", "Toujeo SoloStar", "300 IU/ml · 1.5 ml", "pen", "insulin_glargine", 1, 1),
    ("Insulin Aspart", "NovoRapid FlexPen", "100 IU/ml · 3 ml", "pen", "insulin_aspart", 1, 1),
    ("Insulin Aspart", "Fiasp FlexTouch", "100 IU/ml · 3 ml", "pen", "insulin_aspart", 1, 1),
    ("Human Insulin", "Huminsulin R", "40 IU/ml · 10 ml", "vial", "human_insulin", 1, 1),
    ("Human Insulin", "Actrapid HM", "40 IU/ml · 10 ml", "vial", "human_insulin", 1, 1),
    ("Metformin", "Glycomet", "500 mg · 10 tablets", "tablet", "metformin", 0, 1),
    ("Metformin", "Glucophage", "500 mg · 10 tablets", "tablet", "metformin", 0, 1),
    ("Metformin", "Cetapin XR", "500 mg · 15 tablets", "tablet", "metformin", 0, 1),
    ("Glimepiride", "Amaryl", "1 mg · 10 tablets", "tablet", "glimepiride", 0, 1),
    ("Glimepiride", "Glimisave", "1 mg · 10 tablets", "tablet", "glimepiride", 0, 1),
    ("Sitagliptin", "Januvia", "50 mg · 7 tablets", "tablet", "sitagliptin", 0, 1),
    ("Sitagliptin", "Istavel", "50 mg · 7 tablets", "tablet", "sitagliptin", 0, 1),
    ("Vildagliptin", "Galvus", "50 mg · 14 tablets", "tablet", "vildagliptin", 0, 1),
    ("Vildagliptin", "Jalra", "50 mg · 14 tablets", "tablet", "vildagliptin", 0, 1),
    # Heart / BP / lipids
    ("Atorvastatin", "Atorva", "10 mg · 10 tablets", "tablet", "atorvastatin", 0, 0),
    ("Atorvastatin", "Storvas", "10 mg · 15 tablets", "tablet", "atorvastatin", 0, 0),
    ("Atorvastatin", "Lipitor", "10 mg · 10 tablets", "tablet", "atorvastatin", 0, 1),
    ("Rosuvastatin", "Rosuvas", "10 mg · 15 tablets", "tablet", "rosuvastatin", 0, 0),
    ("Rosuvastatin", "Crestor", "10 mg · 7 tablets", "tablet", "rosuvastatin", 0, 1),
    ("Amlodipine", "Amlong", "5 mg · 10 tablets", "tablet", "amlodipine", 0, 1),
    ("Amlodipine", "Stamlo", "5 mg · 15 tablets", "tablet", "amlodipine", 0, 1),
    ("Telmisartan", "Telma", "40 mg · 15 tablets", "tablet", "telmisartan", 0, 1),
    ("Telmisartan", "Telsartan", "40 mg · 10 tablets", "tablet", "telmisartan", 0, 1),
    ("Losartan", "Losar", "50 mg · 15 tablets", "tablet", "losartan", 0, 1),
    ("Losartan", "Repace", "50 mg · 10 tablets", "tablet", "losartan", 0, 1),
    ("Aspirin", "Ecosprin", "75 mg · 14 tablets", "tablet", "aspirin", 0, 0),
    ("Aspirin", "Disprin", "325 mg · 10 tablets", "tablet", "aspirin", 0, 0),
    ("Clopidogrel", "Clopilet", "75 mg · 10 tablets", "tablet", "clopidogrel", 0, 1),
    ("Clopidogrel", "Plavix", "75 mg · 14 tablets", "tablet", "clopidogrel", 0, 1),
    # Pain / fever / inflammation
    ("Paracetamol", "Dolo", "650 mg · 15 tablets", "tablet", "paracetamol", 0, 0),
    ("Paracetamol", "Crocin Advance", "500 mg · 15 tablets", "tablet", "paracetamol", 0, 0),
    ("Paracetamol", "Calpol", "500 mg · 15 tablets", "tablet", "paracetamol", 0, 0),
    ("Paracetamol", "Pacimol", "650 mg · 10 tablets", "tablet", "paracetamol", 0, 0),
    ("Ibuprofen", "Brufen", "400 mg · 15 tablets", "tablet", "ibuprofen", 0, 0),
    ("Ibuprofen", "Ibugesic", "400 mg · 10 tablets", "tablet", "ibuprofen", 0, 0),
    ("Diclofenac", "Voveran", "50 mg · 10 tablets", "tablet", "diclofenac", 0, 1),
    ("Diclofenac", "Diclofen", "50 mg · 10 tablets", "tablet", "diclofenac", 0, 1),
    ("Aceclofenac", "Zerodol", "100 mg · 10 tablets", "tablet", "aceclofenac", 0, 1),
    ("Aceclofenac", "Hifenac", "100 mg · 10 tablets", "tablet", "aceclofenac", 0, 1),
    ("Tramadol", "Tramazac", "50 mg · 10 capsules", "capsule", "tramadol", 0, 1),
    ("Tramadol", "Ultram", "50 mg · 10 tablets", "tablet", "tramadol", 0, 1),
    # Antibiotics
    ("Amoxicillin", "Mox", "500 mg · 10 capsules", "capsule", "amoxicillin", 0, 1),
    ("Amoxicillin", "Novamox", "500 mg · 10 capsules", "capsule", "amoxicillin", 0, 1),
    ("Amoxicillin", "Amoxil", "500 mg · 10 capsules", "capsule", "amoxicillin", 0, 1),
    ("Amoxicillin + Clavulanate", "Augmentin", "625 mg · 10 tablets", "tablet", "amox_clav", 0, 1),
    ("Amoxicillin + Clavulanate", "Clavam", "625 mg · 10 tablets", "tablet", "amox_clav", 0, 1),
    ("Azithromycin", "Azithral", "500 mg · 3 tablets", "tablet", "azithromycin", 0, 1),
    ("Azithromycin", "Azee", "500 mg · 3 tablets", "tablet", "azithromycin", 0, 1),
    ("Azithromycin", "Zithrox", "500 mg · 3 tablets", "tablet", "azithromycin", 0, 1),
    ("Ciprofloxacin", "Ciplox", "500 mg · 10 tablets", "tablet", "ciprofloxacin", 0, 1),
    ("Ciprofloxacin", "Cifran", "500 mg · 10 tablets", "tablet", "ciprofloxacin", 0, 1),
    ("Ofloxacin", "Oflox", "200 mg · 10 tablets", "tablet", "ofloxacin", 0, 1),
    ("Ofloxacin", "Zanocin", "200 mg · 10 tablets", "tablet", "ofloxacin", 0, 1),
    ("Metronidazole", "Flagyl", "400 mg · 10 tablets", "tablet", "metronidazole", 0, 1),
    ("Metronidazole", "Metrogyl", "400 mg · 10 tablets", "tablet", "metronidazole", 0, 1),
    ("Doxycycline", "Doxy-1", "100 mg · 8 capsules", "capsule", "doxycycline", 0, 1),
    ("Doxycycline", "Microdox", "100 mg · 10 capsules", "capsule", "doxycycline", 0, 1),
    ("Cefixime", "Zifi", "200 mg · 10 tablets", "tablet", "cefixime", 0, 1),
    ("Cefixime", "Taxim-O", "200 mg · 10 tablets", "tablet", "cefixime", 0, 1),
    ("Cefuroxime", "Ceftum", "500 mg · 10 tablets", "tablet", "cefuroxime", 0, 1),
    ("Cefuroxime", "Zocef", "500 mg · 10 tablets", "tablet", "cefuroxime", 0, 1),
    ("Cephalexin", "Phexin", "500 mg · 10 capsules", "capsule", "cephalexin", 0, 1),
    ("Cephalexin", "Sporidex", "500 mg · 10 capsules", "capsule", "cephalexin", 0, 1),
    # Stomach / antiemetic
    ("Pantoprazole", "Pan 40", "40 mg · 15 tablets", "tablet", "pantoprazole", 0, 0),
    ("Pantoprazole", "Pantocid", "40 mg · 15 tablets", "tablet", "pantoprazole", 0, 0),
    ("Pantoprazole", "Pantop", "40 mg · 10 tablets", "tablet", "pantoprazole", 0, 0),
    ("Omeprazole", "Omez", "20 mg · 15 capsules", "capsule", "omeprazole", 0, 0),
    ("Omeprazole", "Ocid", "20 mg · 15 capsules", "capsule", "omeprazole", 0, 0),
    ("Rabeprazole", "Razo", "20 mg · 15 tablets", "tablet", "rabeprazole", 0, 0),
    ("Rabeprazole", "Rabicip", "20 mg · 10 tablets", "tablet", "rabeprazole", 0, 0),
    ("Esomeprazole", "Nexpro", "40 mg · 15 tablets", "tablet", "esomeprazole", 0, 0),
    ("Esomeprazole", "Sompraz", "40 mg · 10 tablets", "tablet", "esomeprazole", 0, 0),
    ("Domperidone", "Domstal", "10 mg · 10 tablets", "tablet", "domperidone", 0, 0),
    ("Domperidone", "Vomistop", "10 mg · 10 tablets", "tablet", "domperidone", 0, 0),
    ("Ondansetron", "Emeset", "4 mg · 10 tablets", "tablet", "ondansetron", 0, 1),
    ("Ondansetron", "Ondem", "4 mg · 10 tablets", "tablet", "ondansetron", 0, 1),
    ("Famotidine", "Famocid", "40 mg · 14 tablets", "tablet", "famotidine", 0, 0),
    ("Famotidine", "Pepcid", "20 mg · 14 tablets", "tablet", "famotidine", 0, 0),
    # Allergy / respiratory
    ("Cetirizine", "Cetzine", "10 mg · 10 tablets", "tablet", "cetirizine", 0, 0),
    ("Cetirizine", "Alerid", "10 mg · 10 tablets", "tablet", "cetirizine", 0, 0),
    ("Cetirizine", "Okacet", "10 mg · 10 tablets", "tablet", "cetirizine", 0, 0),
    ("Levocetirizine", "Levocet", "5 mg · 10 tablets", "tablet", "levocetirizine", 0, 0),
    ("Levocetirizine", "Xyzal", "5 mg · 10 tablets", "tablet", "levocetirizine", 0, 0),
    ("Fexofenadine", "Allegra", "120 mg · 10 tablets", "tablet", "fexofenadine", 0, 0),
    ("Fexofenadine", "Fexova", "120 mg · 10 tablets", "tablet", "fexofenadine", 0, 0),
    ("Montelukast", "Montair", "10 mg · 15 tablets", "tablet", "montelukast", 0, 1),
    ("Montelukast", "Telekast", "10 mg · 10 tablets", "tablet", "montelukast", 0, 1),
    ("Salbutamol", "Asthalin", "2 mg · 10 tablets", "tablet", "salbutamol", 0, 1),
    ("Salbutamol", "Ventolin Inhaler", "100 mcg · 200 md", "inhaler", "salbutamol", 0, 1),
    ("Budesonide", "Budecort", "200 mcg · 200 md", "inhaler", "budesonide", 0, 1),
    ("Budesonide", "Pulmicort", "200 mcg · 200 md", "inhaler", "budesonide", 0, 1),
    # Neuro / specialty
    ("Levetiracetam", "Keppra", "500 mg · 10 tablets", "tablet", "levetiracetam", 0, 1),
    ("Levetiracetam", "Levera", "500 mg · 10 tablets", "tablet", "levetiracetam", 0, 1),
    ("Levetiracetam", "Levipil", "500 mg · 10 tablets", "tablet", "levetiracetam", 0, 1),
    ("Adrenaline", "Adrenaline Tartrate", "1 mg/ml · 1 ml", "ampoule", "adrenaline", 0, 1),
    ("Adrenaline", "Adrena", "1 mg/ml · 1 ml", "ampoule", "adrenaline", 0, 1),
    ("Osimertinib", "Tagrisso", "80 mg · 30 tablets", "tablet", "osimertinib", 0, 1),
    ("Human Albumin", "Alburel-T", "20% · 100 ml", "infusion", "human_albumin", 1, 1),
    ("Human Albumin", "Albudash", "20% · 100 ml", "infusion", "human_albumin", 1, 1),
    # Thyroid / vitamins / supplements
    ("Thyroxine", "Thyronorm", "50 mcg · 100 tablets", "tablet", "thyroxine", 0, 1),
    ("Thyroxine", "Eltroxin", "50 mcg · 100 tablets", "tablet", "thyroxine", 0, 1),
    ("Cholecalciferol", "Uprise-D3", "60K IU · 4 capsules", "capsule", "vitamin_d3", 0, 0),
    ("Cholecalciferol", "Calcirol", "60K IU · 4 sachets", "sachet", "vitamin_d3", 0, 0),
    ("Calcium Carbonate", "Shelcal", "500 mg · 15 tablets", "tablet", "calcium_carbonate", 0, 0),
    ("Calcium Carbonate", "Calcimax", "500 mg · 15 tablets", "tablet", "calcium_carbonate", 0, 0),
    ("Ferrous Ascorbate", "Orofer XT", "100 mg · 10 tablets", "tablet", "iron", 0, 0),
    ("Ferrous Ascorbate", "Fefol-Z", "100 mg · 15 capsules", "capsule", "iron", 0, 0),
    ("Folic Acid", "Folvite", "5 mg · 45 tablets", "tablet", "folic_acid", 0, 0),
    ("Folic Acid", "Folinal", "5 mg · 30 tablets", "tablet", "folic_acid", 0, 0),
    # Antifungals / other
    ("Fluconazole", "Diflucan", "150 mg · 1 capsule", "capsule", "fluconazole", 0, 1),
    ("Fluconazole", "Flucos", "150 mg · 1 tablet", "tablet", "fluconazole", 0, 1),
    ("Itraconazole", "Canditral", "100 mg · 4 capsules", "capsule", "itraconazole", 0, 1),
    ("Itraconazole", "Sporanox", "100 mg · 4 capsules", "capsule", "itraconazole", 0, 1),
    ("Ivermectin", "Ivermectol", "12 mg · 2 tablets", "tablet", "ivermectin", 0, 1),
    ("Ivermectin", "Ivrea", "12 mg · 2 tablets", "tablet", "ivermectin", 0, 1),
    ("Hydroxychloroquine", "HCQS", "200 mg · 10 tablets", "tablet", "hydroxychloroquine", 0, 1),
    ("Hydroxychloroquine", "Oxcq", "200 mg · 10 tablets", "tablet", "hydroxychloroquine", 0, 1),
    ("Dexamethasone", "Decdan", "0.5 mg · 10 tablets", "tablet", "dexamethasone", 0, 1),
    ("Dexamethasone", "Dexona", "0.5 mg · 10 tablets", "tablet", "dexamethasone", 0, 1),
    ("Prednisolone", "Wysolone", "5 mg · 10 tablets", "tablet", "prednisolone", 0, 1),
    ("Prednisolone", "Omnacortil", "5 mg · 10 tablets", "tablet", "prednisolone", 0, 1),
]

# owner_email_key used after users inserted — seed maps emails to ids
# (owner_email, name, license, phone, hours, address, pincode, lat, lng, status)
PHARMACIES = [
    # Chandigarh / Mohali (kept for broader demo)
    ("owner@nivra.local", "CarePlus Pharmacy", "CHD/20B/11017", "9815001101", "8:00 AM – 10:00 PM", "SCO 47, Sector 17, Chandigarh", "160017", 30.7416, 76.7850, "verified"),
    ("citymed@nivra.local", "CityMed 24×7", "CHD/20B/22022", "9815002202", "Open 24 hours", "Booth 12, Sector 22, Chandigarh", "160022", 30.7354, 76.7694, "verified"),
    ("healthbridge@nivra.local", "HealthBridge Chemists", "CHD/20B/08009", "9815003303", "9:00 AM – 9:00 PM", "Sector 8 Market, Chandigarh", "160009", 30.7400, 76.8010, "verified"),
    ("fortis@nivra.local", "Fortis Hospital Pharmacy", "PB/20B/16062", "9815004404", "Open 24 hours", "Fortis Hospital, Mohali", "160062", 30.7070, 76.7180, "verified"),
    ("guardian@nivra.local", "Guardian Lifecare", "CHD/20B/35035", "9815005505", "8:00 AM – 10:00 PM", "Sector 35 Plaza, Chandigarh", "160035", 30.7240, 76.7580, "verified"),
    ("apollo@nivra.local", "Apollo Pharmacy", "CHD/20B/10101", "9815006606", "Open 24 hours", "Manimajra Main Road, Chandigarh", "160101", 30.7190, 76.8350, "verified"),
    # Rohtak — ample verified shops
    ("rohtak1@nivra.local", "Rohtak Medisure", "HR/RTK/124001/01", "9812011101", "8:00 AM – 10:00 PM", "Model Town Market, Rohtak", "124001", 28.8958, 76.6066, "verified"),
    ("rohtak2@nivra.local", "Shri Ram Medical Hall", "HR/RTK/124001/02", "9812012202", "Open 24 hours", "Civil Hospital Road, Rohtak", "124001", 28.8985, 76.6120, "verified"),
    ("rohtak3@nivra.local", "PGIMS Campus Pharmacy", "HR/RTK/124001/03", "9812013303", "Open 24 hours", "PGIMS / UHSR Campus, Rohtak", "124001", 28.8920, 76.6195, "verified"),
    ("rohtak4@nivra.local", "Sun City Chemists", "HR/RTK/124021/01", "9812014404", "9:00 AM – 9:30 PM", "Sector 1, HUDA, Rohtak", "124021", 28.8805, 76.5980, "verified"),
    ("rohtak5@nivra.local", "Jindal Life Care", "HR/RTK/124001/04", "9812015505", "8:30 AM – 10:00 PM", "Old Bus Stand Market, Rohtak", "124001", 28.9012, 76.6018, "verified"),
    ("rohtak6@nivra.local", "Dabra Medical Store", "HR/RTK/124001/05", "9812016606", "8:00 AM – 9:00 PM", "Dabra Chowk, Rohtak", "124001", 28.8870, 76.5905, "verified"),
    ("rohtak7@nivra.local", "Quilla Road Pharmacy", "HR/RTK/124001/06", "9812017707", "Open 24 hours", "Quilla Road, Near Railway Station, Rohtak", "124001", 28.9055, 76.6155, "verified"),
    ("rohtak8@nivra.local", "Asthal Bohar Medicos", "HR/RTK/124021/02", "9812018808", "9:00 AM – 9:00 PM", "Asthal Bohar, Rohtak", "124021", 28.8725, 76.6250, "verified"),
    ("rohtak9@nivra.local", "Sonipat Road Lifeline", "HR/RTK/124001/07", "9812019909", "8:00 AM – 11:00 PM", "Sonipat Road Crossing, Rohtak", "124001", 28.9100, 76.6280, "verified"),
    ("rohtak10@nivra.local", "Bhiwani Road Wellness", "HR/RTK/124001/08", "9812020010", "8:00 AM – 10:00 PM", "Bhiwani Road, Industrial Area, Rohtak", "124001", 28.8780, 76.5805, "verified"),
    ("rohtak11@nivra.local", "Kalanaur Family Chemist", "HR/RTK/124113/01", "9812021111", "9:00 AM – 8:30 PM", "Kalanaur Main Bazaar, Rohtak", "124113", 28.8305, 76.4905, "verified"),
    ("rohtak12@nivra.local", "Meham Care Pharmacy", "HR/RTK/124112/01", "9812022222", "8:30 AM – 9:00 PM", "Meham Bus Stand Market, Rohtak", "124112", 28.9630, 76.2955, "verified"),
]

ROHTAK_OWNER_USERS = [
    ("Ankit Malik", "rohtak1@nivra.local", "9812011101"),
    ("Suman Rana", "rohtak2@nivra.local", "9812012202"),
    ("PGIMS Desk", "rohtak3@nivra.local", "9812013303"),
    ("Neha Hooda", "rohtak4@nivra.local", "9812014404"),
    ("Vikram Jindal", "rohtak5@nivra.local", "9812015505"),
    ("Rajesh Dabra", "rohtak6@nivra.local", "9812016606"),
    ("Quilla Desk", "rohtak7@nivra.local", "9812017707"),
    ("Pooja Bohar", "rohtak8@nivra.local", "9812018808"),
    ("Amit Sonipat", "rohtak9@nivra.local", "9812019909"),
    ("Bhiwani Desk", "rohtak10@nivra.local", "9812020010"),
    ("Kalanaur Desk", "rohtak11@nivra.local", "9812021111"),
    ("Meham Desk", "rohtak12@nivra.local", "9812022222"),
]


def stock_plan_for_pharmacy(pharmacy_index: int, medicine_count: int) -> list[tuple[int, int, int | None]]:
    """Return (medicine_id_1based, packs, price) rows for one pharmacy."""
    rows = []
    # Rotate which brands each shop carries so salt alternatives appear across the city.
    start = (pharmacy_index * 7) % medicine_count
    take = min(38, medicine_count)
    for offset in range(take):
        mid = ((start + offset * 3) % medicine_count) + 1
        packs = 4 + ((pharmacy_index + offset) * 5) % 22
        if offset % 11 == 0:
            packs = 1 + (pharmacy_index % 2)  # some low stock
        price = 35 + ((mid * 17 + pharmacy_index * 11) % 420)
        # Specialty / cold-chain-ish pricing bump for early insulin rows
        if mid <= 7:
            price = 650 + (mid * 40) + pharmacy_index * 8
        if mid in {99, 100}:  # albumin-ish near end — adjust by salt later in seed
            price = 3800 + pharmacy_index * 50
        rows.append((mid, packs, price))
    return rows


def inventory_rows(now, pharmacy_count: int, medicine_count: int):
    """Build inventory tuples: pharmacy_id, medicine_id, packs, price, verified_at."""
    out = []
    for p in range(1, pharmacy_count + 1):
        for medicine_id, packs, price in stock_plan_for_pharmacy(p - 1, medicine_count):
            minutes = 2 + ((p + medicine_id) % 25)
            out.append((p, medicine_id, packs, price, now - timedelta(minutes=minutes)))
    return out
