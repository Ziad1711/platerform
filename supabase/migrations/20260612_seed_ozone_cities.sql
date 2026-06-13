-- Seed OZONE cities into delivery_cities and delivery_rates
-- Provider ID: 5f806347-45f1-481a-901d-2eb98b20b3a8

-- First ensure default pricing group exists
INSERT INTO pricing_groups (provider_id, name, is_default)
VALUES ('5f806347-45f1-481a-901d-2eb98b20b3a8', 'Default', true)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_provider_id CONSTANT uuid := '5f806347-45f1-481a-901d-2eb98b20b3a8';
    v_city_data jsonb;
    v_entry jsonb;
    v_city_id uuid;
    v_pg_id uuid;
    v_count integer := 0;
BEGIN
    SELECT id INTO v_pg_id FROM pricing_groups WHERE provider_id = v_provider_id AND is_default = true;
    IF v_pg_id IS NULL THEN
        RAISE EXCEPTION 'No default pricing group found for OZONE provider';
    END IF;

    v_city_data := '[
        {"id":37,"n":"Agadir","d":35,"r":10},{"id":49,"n":"Ait Melloul","d":35,"r":10},
        {"id":55,"n":"Al Hoceima","d":45,"r":10},{"id":61,"n":"Safi","d":40,"r":10},
        {"id":73,"n":"Beni Mellal","d":40,"r":10},{"id":91,"n":"Boujdour","d":45,"r":10},
        {"id":103,"n":"Dakhla","d":45,"r":10},{"id":109,"n":"El Jadida","d":35,"r":10},
        {"id":127,"n":"Fes","d":35,"r":10},{"id":133,"n":"Fnideq","d":45,"r":10},
        {"id":139,"n":"Fquih Ben Salah","d":45,"r":10},{"id":151,"n":"Inzegane","d":35,"r":10},
        {"id":157,"n":"Kasba Tadla","d":45,"r":10},{"id":169,"n":"Khouribga","d":40,"r":10},
        {"id":187,"n":"Larache","d":40,"r":10},{"id":193,"n":"M Diq","d":45,"r":10},
        {"id":199,"n":"Marrakech","d":35,"r":10},{"id":205,"n":"Martil","d":40,"r":10},
        {"id":211,"n":"Meknes","d":35,"r":10},{"id":217,"n":"Nador","d":45,"r":10},
        {"id":223,"n":"Ouarzazat","d":45,"r":10},{"id":229,"n":"Oujda","d":45,"r":10},
        {"id":235,"n":"Ain Harouda","d":30,"r":10},{"id":271,"n":"Cabo Negro","d":45,"r":10},
        {"id":289,"n":"Tanger","d":35,"r":10},{"id":313,"n":"Tetouan","d":35,"r":10},
        {"id":327,"n":"Azrou","d":40,"r":10},{"id":333,"n":"Ifran","d":45,"r":10},
        {"id":339,"n":"Imouzar Kandre","d":45,"r":10},{"id":345,"n":"Mohammedia","d":35,"r":10},
        {"id":364,"n":"Ain Leuh","d":45,"r":10},{"id":370,"n":"Sidi Aadi - Azrou","d":45,"r":10},
        {"id":376,"n":"Tiznit","d":40,"r":10},{"id":382,"n":"Taroudant","d":40,"r":10},
        {"id":403,"n":"Errahma Ville","d":30,"r":10},{"id":409,"n":"Tamaris","d":35,"r":10},
        {"id":415,"n":"Dar Bouazza","d":35,"r":10},{"id":421,"n":"Bouskoura","d":30,"r":10},
        {"id":427,"n":"Jamaat Shaim","d":45,"r":10},{"id":433,"n":"Nouaceur","d":35,"r":10},
        {"id":439,"n":"Sebt Gzoula","d":45,"r":10},{"id":445,"n":"Souiria","d":45,"r":10},
        {"id":457,"n":"Sidi Kacem","d":40,"r":10},{"id":463,"n":"Sidi Sliman","d":45,"r":10},
        {"id":472,"n":"Bouznika","d":40,"r":10},{"id":478,"n":"Tit Mellil","d":30,"r":10},
        {"id":493,"n":"Daroua","d":35,"r":10},{"id":511,"n":"Benslimane","d":35,"r":10},
        {"id":523,"n":"Azemmour","d":45,"r":10},{"id":529,"n":"Moulay Abdellah","d":40,"r":10},
        {"id":535,"n":"Midelt","d":45,"r":10},{"id":571,"n":"Mediouna","d":35,"r":10},
        {"id":583,"n":"Chefchaouen","d":45,"r":10},{"id":601,"n":"Ben Guerir","d":45,"r":10},
        {"id":607,"n":"Errachidia","d":45,"r":0},{"id":619,"n":"Riche-02","d":45,"r":0},
        {"id":724,"n":"Had Soualem","d":35,"r":10},{"id":731,"n":"Sidi Rahhal","d":35,"r":10},
        {"id":766,"n":"Oued Zem","d":45,"r":10},{"id":773,"n":"Boufkrane","d":45,"r":20},
        {"id":780,"n":"Sbaa Ayoune","d":45,"r":10},{"id":787,"n":"Moly Drisse Zarhoune","d":45,"r":20},
        {"id":794,"n":"Lmhaya","d":45,"r":10},{"id":801,"n":"Lhaj Kadour Ville","d":45,"r":20},
        {"id":808,"n":"Tawjtat","d":45,"r":10},{"id":879,"n":"Bab Berred","d":45,"r":10},
        {"id":886,"n":"Laaroui","d":45,"r":10},{"id":893,"n":"Selouane","d":45,"r":10},
        {"id":900,"n":"Segangan","d":45,"r":10},{"id":907,"n":"Beni Ensar","d":45,"r":10},
        {"id":935,"n":"Sidi Bennour","d":45,"r":10},{"id":942,"n":"Sidi Bibi","d":45,"r":10},
        {"id":949,"n":"Keliaa","d":45,"r":10},{"id":956,"n":"Oulad Teima","d":45,"r":10},
        {"id":963,"n":"Anza","d":40,"r":10},{"id":970,"n":"Walidia","d":45,"r":10},
        {"id":984,"n":"Boujniba","d":45,"r":10},{"id":1019,"n":"Skhour Rehamna","d":45,"r":10},
        {"id":1033,"n":"Zagora","d":45,"r":10},{"id":1040,"n":"Ouazzane","d":45,"r":10},
        {"id":1047,"n":"Zaouiat Cheikh","d":45,"r":10},{"id":1068,"n":"Biougra","d":45,"r":10},
        {"id":1075,"n":"Ait Amira","d":45,"r":10},{"id":1082,"n":"Mehdia","d":45,"r":10},
        {"id":1089,"n":"Kenitra","d":35,"r":10},{"id":1096,"n":"Mehdia Ville","d":45,"r":10},
        {"id":1124,"n":"Sidi Kaouki","d":45,"r":10},{"id":1131,"n":"Mhamid El Ghizlane","d":45,"r":10},
        {"id":1138,"n":"Boumia","d":45,"r":10},{"id":1145,"n":"Chellalat","d":35,"r":10},
        {"id":1236,"n":"Bejaad","d":45,"r":10},{"id":1243,"n":"El Mansouria","d":35,"r":10},
        {"id":1250,"n":"Rissani","d":45,"r":10},{"id":1257,"n":"Erfoud","d":45,"r":10},
        {"id":1264,"n":"Missour","d":45,"r":10},{"id":1271,"n":"Khemisset","d":45,"r":10},
        {"id":1278,"n":"Tiflet","d":45,"r":10},{"id":1286,"n":"Goulmima","d":45,"r":10},
        {"id":1293,"n":"Tinejdad","d":45,"r":10},{"id":1300,"n":"Oualmes","d":45,"r":10},
        {"id":1314,"n":"Rommani","d":45,"r":10},{"id":1321,"n":"Houara","d":45,"r":10},
        {"id":1328,"n":"Drarga","d":45,"r":10},{"id":1342,"n":"Belfaa","d":45,"r":10},
        {"id":1356,"n":"Souk Sebt Oulad Nemma","d":45,"r":10},{"id":1363,"n":"El Hajeb","d":45,"r":10},
        {"id":1384,"n":"Jerada","d":45,"r":10},{"id":1391,"n":"Kelaat M Gouna","d":45,"r":10},
        {"id":1398,"n":"Layoun Cherkia","d":45,"r":10},{"id":1412,"n":"Bir Jdid","d":35,"r":10},
        {"id":1419,"n":"Sidi Hajjaj","d":35,"r":10},{"id":1440,"n":"Moulay Yaacoub","d":45,"r":10},
        {"id":1447,"n":"Sidi Harazem","d":45,"r":10},{"id":1454,"n":"Ras El Ma","d":45,"r":10},
        {"id":1461,"n":"Ain Cheggag","d":45,"r":10},{"id":1468,"n":"Kariat Ba Mohamed","d":45,"r":10},
        {"id":1475,"n":"Tinghir","d":45,"r":10},{"id":1482,"n":"Imzouren","d":45,"r":10},
        {"id":1489,"n":"Bni Bouayach","d":45,"r":10},{"id":1531,"n":"Boumaln Dades","d":45,"r":10},
        {"id":1536,"n":"Zayou","d":45,"r":10},{"id":1539,"n":"Aglou","d":45,"r":10},
        {"id":1540,"n":"Tafraoute","d":45,"r":10},{"id":1541,"n":"Oulad Jerrar","d":45,"r":10},
        {"id":1542,"n":"Bounaamane","d":45,"r":10},{"id":1543,"n":"El Maader El Kabir","d":45,"r":10},
        {"id":1544,"n":"Maaziz","d":45,"r":10},{"id":1545,"n":"Sebt El Guerdane","d":45,"r":10},
        {"id":1546,"n":"Alnif","d":45,"r":10},{"id":1547,"n":"Taghazout","d":45,"r":10},
        {"id":1548,"n":"Tamraght","d":45,"r":10},{"id":1549,"n":"Aourir","d":45,"r":10},
        {"id":1555,"n":"Kariat Arkman","d":45,"r":10},{"id":1556,"n":"Had Hrara","d":45,"r":10},
        {"id":1557,"n":"Tnine El Ghiate","d":45,"r":10},{"id":1558,"n":"Berrechid","d":35,"r":10},
        {"id":1559,"n":"Tamansourt","d":45,"r":10},{"id":1560,"n":"Oudaya","d":45,"r":10},
        {"id":1561,"n":"Louizia","d":35,"r":10},{"id":1562,"n":"Ajdir","d":45,"r":10},
        {"id":1563,"n":"Sidi Bouzid","d":45,"r":10},{"id":1564,"n":"Jorf Sefar","d":45,"r":10},
        {"id":1565,"n":"Mazagan","d":45,"r":10},{"id":1566,"n":"Msawar Raso","d":45,"r":10},
        {"id":1567,"n":"Lhawzia","d":45,"r":10},{"id":1568,"n":"Zaouit Sidi Smail","d":45,"r":10},
        {"id":1569,"n":"Had Oulad Fraj","d":45,"r":10},{"id":1570,"n":"Ain Bni Mathar","d":45,"r":10},
        {"id":1571,"n":"Jorf El Melha","d":45,"r":10},{"id":1572,"n":"Had Kourt","d":45,"r":10},
        {"id":1573,"n":"Ain Dorij","d":45,"r":10},{"id":1574,"n":"Agouray","d":45,"r":10},
        {"id":1575,"n":"Bouderbala","d":45,"r":10},{"id":1576,"n":"Temsia","d":45,"r":10},
        {"id":1577,"n":"Tohmo","d":45,"r":10},{"id":1578,"n":"Kasbah El Taher","d":45,"r":10},
        {"id":1579,"n":"Tamraght","d":45,"r":10},{"id":1580,"n":"Gfifat","d":45,"r":10},
        {"id":1581,"n":"Oulad Dahou","d":45,"r":10},{"id":1582,"n":"Tin Mansour","d":45,"r":10},
        {"id":1583,"n":"Ain Seddaq","d":45,"r":10},{"id":1584,"n":"Oulad Berhil","d":45,"r":10},
        {"id":1585,"n":"Ait Iaaza","d":45,"r":10},{"id":1586,"n":"Ain El Mediour","d":45,"r":10}
    ]';

    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_city_data)
    LOOP
        INSERT INTO delivery_cities (provider_id, external_city_id, city_name)
        VALUES (v_provider_id, (v_entry->>'id')::bigint, v_entry->>'n')
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_city_id;

        IF v_city_id IS NOT NULL THEN
            INSERT INTO delivery_rates (pricing_group_id, provider_id, external_city_key, city_name, price, cost_refuse, cost_cancel)
            VALUES (v_pg_id, v_provider_id, (v_entry->>'id')::bigint, v_entry->>'n',
                    (v_entry->>'d')::numeric, 0, (v_entry->>'r')::numeric);
            v_count := v_count + 1;
        END IF;
        v_city_id := NULL;
    END LOOP;

    RAISE NOTICE 'Inserted % new OZONE cities with rates', v_count;
END $$;
