/**
 * Préférences d'affichage.
 *
 * Distinctes des réglages du moteur (`REGLAGES_PLAN`) : celles-ci ne changent
 * rien à la planification ni à la mémoire, seulement au confort d'usage. Elles
 * voyagent tout de même dans le même fichier de sauvegarde, pour qu'un
 * export/import restitue l'application telle qu'on l'avait laissée.
 */

export const PREFERENCES_DEFAUT = {
  /** Brasser les propositions à chaque passage. Désactiver revient à mémoriser
   *  des positions plutôt que du contenu : à ne faire qu'en connaissance de cause. */
  melangerPropositions: true,
};

/*
 * `delaiEnchainementMs` a existé ici : un enchaînement automatique après une
 * bonne réponse. Retiré — une explication de sept cents signes ne se lit pas en
 * huit dixièmes de seconde, et le réglage escamotait le retour au lieu de
 * l'accélérer. Une sauvegarde ancienne peut encore porter le champ ; il est
 * simplement ignoré.
 */

export function fusionner(enregistrees) {
  return { ...PREFERENCES_DEFAUT, ...(enregistrees ?? {}) };
}
