-- ============================================================
-- Rushliv : tarifs de livraison (grille officielle saisie manuellement)
-- L'API Rushliv n'expose aucun tarif : la grille est donc saisie
-- manuellement (ville par ville). Ce seed rend ces tarifs
-- reproductibles sur tout environnement (dev, staging, prod).
-- Idempotent : upsert par (pricing_group_id, external_city_key).
-- Un tarif existant (> 0) saisi manuellement n'est JAMAIS écrasé par ce
-- seed : seuls les tarifs manquants / à 0 sont renseignés (même règle que la
-- synchro des villes Rushliv).
-- ============================================================

do $seed$
declare
  v_provider_id uuid;
  v_pg_id uuid;
  v_entry text;
  v_parts text[];
  v_data constant text := $d$4241|Afourar|40;4248|Agadir|35;4255|Agdz|40;4283|Ain Taoujdate|45;4290|Ait amira|40;4311|Ait Ourir|40;4318|Ajdir Hociema|40;4325|AKCHOUR|40;4332|Aklim|40;4339|Al Aaroui|40;4346|NADOR|45;4353|Beni Ensar|45;4360|SELOUANE|40;4367|JAADAR|40;4374|Zeghanghane|40;4381|AFRA|40;4388|BOUARG|40;4402|Mariouari|40;4409|BARICHINO|40;4416|Tiztoutine|40;4423|Beni Chiker|40;4430|Farkhana|40;4437|Beni Sidal Jbel|40;4444|Kariat Arekmane NADOR|40;4451|ZAIO|40;4458|Ouled Settout|40;4465|Driouch|45;4472|BEN tAIB|40;4479|Tafersit|40;4486|Midar|45;4493|Kassita|40;4500|Telat Azlaf|40;4507|Tamsamane|40;4514|Boudinar|40;4521|Dar El Kebdani|40;4528|Berkane|40;4535|AHFIR|40;4542|Ain Erreggada|40;4549|Boughriba|40;4556|Madagh|40;4563|SAAIDIA|40;4570|Beni Drar|40;4577|OUJDA|40;4584|JERADA|40;4591|AIN BENI MATHAR|40;4598|Tendrara|40;4605|Bouarfa|45;4612|Figuig|45;4619|Laayoune Charkia|45;4626|Taourirt|45;4633|Guercif|45;4640|Aglou|40;4654|Ait Baha|40;4661|Ait melloul|35;4668|Akka|45;4675|Anza|40;4682|Aoulouz|40;4689|Aourir|40;4696|Belfaa|40;4703|Biougra|40;4710|foum lahcen tata|45;4717|Foum zguid|45;4724|Houara|40;4731|Imi Ouaddar|40;4738|Inchaden|40;4745|Inzegane|35;4752|LEQliAA|40;4759|Massa|40;4766|Mirleft|45;4773|Oulad Berhil|45;4780|Oulad Dahou|45;4787|Tiznit|40;4794|Tin Mansour|45;4801|TATA|45;4808|Taroudant|45;4815|Temsia|45;4822|Tamraght|45;4829|Taliouine|45;4836|Taghazout|45;4843|SIDI IFNI|45;4857|Sebt El Guerdane|40;4864|Dcheira|40;4871|Taddart Agadir|45;4878|Tarrast|35;4885|Rabat|35;4892|Sala El Jadida|35;4899|Sale|35;4906|Fquih Ben Salah|40;4913|Tighassaline|45;4920|Temara|35;4927|Ain Aouda|40;4962|Ain Harrouda|30;4969|AZILAL|40;4976|Aghbalou cerdan|40;4990|Ain Chkef|40;4997|Boudnib|45;5004|Ain Cheggag|40;5018|Ain Atiq|40;5025|Ain Allah|40;5039|Skhirat|45;5046|BOUSKOURA|35;5053|Skhour Rehamna|45;5074|Tamesna|40;5095|Tamesluht|45;5102|Sidi Yahya Zaer|45;5130|Tamellalt|45;5144|Tamaris|35;5151|Ghafsai|40;5158|Tamansourt|45;5165|Merzouga|45;5172|Sidi Bouzid SAFI|40;5179|Zaouit Sidi Smail|45;5186|Lalla Takerkoust|40;5193|Amizmiz|40;5200|Sidi Yahya Du Gharb|45;5207|Sidi Taibi|45;5221|Sidi Slimane|45;5228|Sidi Rahal|40;5235|Zagoura|45;5242|Sidi Kacem|40;5249|Sidi Harazem|40;5263|Sidi Abdellah Ghiat|40;5284|Zagoura|45;5291|Sidi Bou Othmane|40;5298|Tazarine|45;5305|Sidi Bennour|40;5312|Demnate|40;5319|El Attaouia|40;5326|El Kelaa des Sraghna|40;5333|Lalla Mimouna|40;5340|Mechra Bel Kesiri|40;5347|Souk Elarbaa Du Gharb|45;5361|Khemis zemamera|40;5368|Sidi Allal El Bahraoui|40;5396|Sidi Abbad|40;5403|Sebt Saiss|40;5424|Ouahat Sidi Brahim|45;5431|Ouled Moussa Beni Mellal|40;5438|Bouknadel|40;5445|Ouled Mbarek  Beni mellal|40;5452|KENITRA|35;5459|Tiflet|45;5466|Khenifra du Atlas|40;5480|Khemisset ville|45;5494|Kaf Nsour KHENIFRA|40;5501|Tanougha beni mellal|45;5508|El Kebab KHENIFRA|45;5515|El Borj KHENIFRA|40;5522|zoumi ouazzane|45;5536|Timoulilte beni mellal|45;5543|Boulanouare khouribga|40;5557|Hattane Khouribga|40;5564|Zaouiat Cheikh|45;5571|Mzoudia|45;5578|Zaida|45;5585|ZAGORA VILLE|45;5599|Youssoufia|45;5606|Oualidia|45;5620|Tnine Gharbia|45;5627|Tnine Chtouka El jadida|45;5641|Lahri khenifra|40;5669|Tit Mellil|30;5676|Ait Ishaq|40;5683|Aguelmous|40;5690|Tissint Tata|45;5697|Tinghir|45;5704|Essaouira|40;5711|Tinejdad|45;5732|Tikiouine|40;5739|Mrirt|45;5746|Tetouan|35;5753|Mejjat|40;5760|Teroual Ouezzane|45;5767|Taznakht|45;5774|Taza|45;5781|Bab Taza|40;5788|Tassoultante|45;5795|Targuist|45;5802|Tagmout tata|45;5809|Tarfaya|45;5816|Issafen tata|45;5823|Taounate|45;5830|TANTAN|45;5844|Tanger|35;5851|Sid L Mokhtar|40;5858|Tahla|45;5865|Tahannaout|40;5872|Issaguen|40;5879|Tafraoute|45;5886|Tafoughalt|45;5893|Oued Laou|45;5907|Kabila|40;5914|marina smir|40;5928|bouanane tetoun|40;5935|Souk Sebt Oulad Nemma|45;5956|Souihla|45;5970|Sidi bibi|45;5977|Bhalil|40;5998|Bouizakarne|40;6019|Souk Khemis du Sahel|40;6026|Sidi Bouzid El Jadida|40;6033|Zagoura|45;6040|Zagoura|45;6047|Sid Zouine|40;6061|Settat|40;6075|Sefrou|40;6089|Sebt Gzoula|40;6096|Sabaa Aiyoun|40;6103|Ain Dfali ouazzane|40;6110|Safi|40;6124|RISSANI|45;6131|imintanoute|40;6138|RICHE|45;6145|Chichaoua|45;6152|Ras El Ma Fes|40;6159|Chouiter|40;6166|Bouznika|40;6173|Outat El Haj|45;6180|Ourika|40;6187|Belaaguid|40;6194|OULAD BEN RAHMOUN|40;6201|Oulad Teima|40;6208|Gouassem|40;6215|Oulad Ayad|45;6222|Imzouren|40;6229|Oued Zem|45;6236|Oued Amlil|45;6243|Boulemane|45;6250|OUDAYA Marrakech|45;6257|Ouazzane|45;6264|El Garra|40;6271|Ouarzazate|45;6285|Nouaceur|35;6292|Moulay Yaacoub|45;6299|Mohammedia|33;6306|Moulay Bousselham|45;6313|Moulay Idriss Zerhoun|40;6320|Plage David Bouznika|40;6327|Missour|45;6334|Ben Yakhlef|40;6341|MIDELT|45;6348|Meknes|40;6355|MEHDIA|40;6369|Mediouna|35;6376|CHRAFAT Chefchaouen|40;6383|Martil|40;6390|Marrakech|35;6397|El Jebeha|40;6411|Madiq|40;6425|Bni ayat|40;6432|LMHAYA|40;6439|El Haj Kaddour|40;6446|Oulad zemam|40;6453|Khenifra|40;6460|Larache|40;6467|Sidi jaber beni mellal|40;6481|Sidi Aissa Ben Ali|45;6488|ighrem laalam|40;6502|Tagzirt Beni Mellal|40;6509|Souk El Had Des Bradia|40;6516|Laayoune Sahara|45;6523|laayoune Port|45;6530|Dar ould zidouh|40;6537|Ksar Sghir|40;6544|Ksar El Kebir|40;6551|El Ksiba beni mellal|40;6558|Khouribga|40;6565|Dlalha|40;6579|Kelaat MGouna|45;6586|Kasba Tadla|40;6593|Msemrir tinghir|45;6600|Kariat Ba Mohamed|40;6607|Jorf Lasfar|40;6614|Aoufous|45;6621|Jorf El Melha|40;6628|Jamaat shaim|40;6642|Imouzzer Kandar|40;6656|Ifrane|35;6670|Harhoura|40;6677|had oulad frej|40;6684|Had Soualem|40;6698|Hrara Safi|40;6705|Guelmim|45;6712|Goulmima|45;6719|Lagfifat|40;6726|Fnideq|40;6733|Fes|35;6740|Essemara|45;6747|Errahma|30;6754|ERRACHIDIA|45;6761|Erfoud|45;6768|El Hajeb|40;6775|El Ouatia TAN TAN|45;6782|El Mansouria|35;6789|Kasbah taher|40;6803|Agourai|40;6810|Ain dorij|40;6817|El haouzia|40;6831|Alnif|45;6838|Bounaamane tiznit|40;6845|Ouled jerrar|40;6852|Al Hoceima|40;6859|Beni Mellal|40;6866|Boujdour|45;6873|Casablanca|19;6880|Dakhla|45;6887|El Jadida|35;6894|Cabo Negro|40;6901|AZROU|40;6908|Dar Bouazza|35;6915|Deroua|35;6922|Benslimane|40;6929|Azemmour|40;6936|Chefchaouen|40;6943|Ben Guerir|40;6950|Boufakrane|40;6957|Bab Berred|40;6964|Boujniba|40;6971|Echemmaia|40;6985|Boumia|45;6992|Bejaad|40;6999|Bir Jdid|40;7006|Asilah|40;7013|Boumaln dads|45;7020|BERRECHID|35;7029|Ouled Tayeb|40;7036|Ain Beida|40;7043|El Menzel|40;7050|Ribate El Kheir|40;7057|Douiet|40;7064|Dar 16|30;7078|Mkansa|25;7085|Lahraouyine|25;7092|Sidi Massoud|30;7099|La ville verte|35;7106|Moulay Abellah Amghar|40;7113|Sidi Ali Azemmour|40;7120|Oulad Ghanem|45;7127|Arba Aounate|40;7134|Oulad Amrane|40;7141|Laayayta|40;7148|Ouaouizeght|45;7155|Oulad Yaich|40;7162|Oulad Youssef|40;7169|Oulad Ali Beni Mellal|40;7176|Had Boumoussa|40;7183|Ouaoumana|45;7190|Foum Oudi Beni Mellal|40;7197|Ouled Said El Oued|40;7204|Moulay Bouazza KHENIFRA|45;7211|Tachrafat|40;7218|Ouled Driss|40;7225|Al Khalfia|40;7232|OULAD MRAH|40;7239|Ait Rbaa|40;7246|Ait Ali|40;7253|Ouled Smail|40;7260|Adouz|40;7267|Foum El Ansar|40;7277|Gueznaia|40;7284|Bouzaghlal|45;7291|Azla|40;7298|Ben Rezin|40;7305|Alanssar|40;7312|Khemis madiaq|40;7319|Ounnana|40;7326|Brikcha|40;7340|belyonnech|40;7361|Asni|40;7368|Ouidane MARRAKECH|40;7375|OULAD HASSOUN|40;7382|Nzalat Laadam|40;7396|Moulay Brahim|40;7403|Douar Sidi Moussa|40;7410|Oulad yahya|40;7417|Douar Soultan|40;7424|Douar Bouazza|40;7431|Gourrama|45;7438|Imilchil|45;7453|El borouj|40;7459|LOUIZIA|40;7465|sidi hajjaj|40;7471|Zenata|40;7477|drarga|40;7483|Assa-Zag|35;7489|Errich|45;7495|Lhanchan|45;7501|Arbaoua|45;7507|Chelalat|45;7513|Ras El Ain Ben Ahmed|45;7519|Guisser|40;7525|El Aouamra|45;7531|Tissa|45;7537|Laâtamna|45;7543|Ghazoua|45;7549|CHÉRIFIA|45;7555|El afaq|45;7561|Sidi Hajjaj oued Hassar|45;7567|Tamanar|45;7573|Oulmès|45;7579|Sidi allal tazi|45;7585|Mzouda|45;7591|RAS EL MA|45;7597|SKOURA|45;7603|OUNAGHA|45;7609|Rommani|45;7615|maaziz|45;7621|Aknoul|45;7627|Smimou|45;7633|Jamaat Fdalate|35;7639|Sidi bousberr|45;7645|khenichet|45;7651|Ben Ahmed|35;7657|Sidi moussa ben ali|45;7669|OULAD ABBOU|45;7675|OULAD SAID|45;7681|TAMANART|45;7687|AIT IAAZA|45;7693|Ouaouizeght|45;7699|Oulad Ayad - Souk Sebt|43;7705|Tanant|40;7711|Ait Attab|40;7717|Bin El-Ouidane|43;7723|Ouzoud|40;7729|Foum jemaa|40;7735|Sidi Moussa "Région de Marrakech"|45;7741|Bouderbala|40;7748|Sidi Ayache|45;7754|Mers el kheir|40;7760|LAKHSASS|45;7766|HAD KOURT|45;7772|BENI TADJIT|45;7778|Mssawar rasso|30;7784|TALMEST|45;7790|Akhefnir|45;7796|El Marsa (Laâyoune)|45;7808|BENI BOUAYACH|45;7814|GUIGOU|45;7820|TIMAHDIT|40;7826|STEHAT|45;7832|BEN AHMED CHEFCHAWN|45;7838|BIRKOUATE|45;7844|ITZER|45;7850|Sidi moussa lmajdoub|40;7856|AGHBALA|40;7862|TOUNFITE|45;7874|Dar Gueddari|40;7880|TLAT OULAD FINI|40;7886|BZOU|45;7892|Tizi nisly|45;7898|Beggara|45;7904|Dar Bel Amri|45;7910|Douar Lemsaada|45;7916|Boumaiz|45;7922|Souk El hed Oulad Jelloul|45;7928|Souk Tlet Du Gharb|45;7934|Souk El Arbaa Du Gharb|45;7946|N'khakhsa|45;7952|Sidi Ayache Ouled Slama|45;7958|Tandit|45$d$;
  v_applied integer := 0;
begin
  select id into v_provider_id
  from public.integration_providers
  where slug = 'rushliv';

  if v_provider_id is null then
    raise exception 'Provider rushliv introuvable';
  end if;

  select id into v_pg_id
  from public.pricing_groups
  where provider_id = v_provider_id
    and user_id is null
    and integration_id is null
    and is_default = true;

  if v_pg_id is null then
    insert into public.pricing_groups (provider_id, user_id, integration_id, name, is_default)
    values (v_provider_id, null, null, 'default', true)
    returning id into v_pg_id;
  end if;

  foreach v_entry in array string_to_array(v_data, ';')
  loop
    v_parts := string_to_array(v_entry, '|');
    if coalesce(v_parts[1], '') = '' or coalesce(v_parts[2], '') = '' then
      continue;
    end if;

    insert into public.delivery_rates as dr (
      pricing_group_id,
      provider_id,
      external_city_key,
      city_name,
      price,
      updated_at
    )
    values (
      v_pg_id,
      v_provider_id,
      v_parts[1]::bigint,
      v_parts[2],
      v_parts[3]::numeric,
      now()
    )
    on conflict (pricing_group_id, external_city_key) do update
      set price = excluded.price,
          updated_at = now()
      where dr.price <= 0;

    v_applied := v_applied + 1;
  end loop;

  raise notice 'Rushliv: % tarifs traités (tarifs existants > 0 préservés)', v_applied;
end
$seed$;
