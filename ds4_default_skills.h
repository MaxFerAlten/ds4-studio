#ifndef DS4_DEFAULT_SKILLS_H
#define DS4_DEFAULT_SKILLS_H

#include <stdbool.h>
#include <stddef.h>

#define DS4_SOUL_BEGIN \
    "[BEGIN DS4 DEFAULT SOUL POLICY]"
#define DS4_SOUL_END \
    "[END DS4 DEFAULT SOUL POLICY]"

#define DS4_ETHIC_BEGIN \
    "[BEGIN DS4 DEFAULT ETHIC POLICY]"
#define DS4_ETHIC_END \
    "[END DS4 DEFAULT ETHIC POLICY]"

#define DS4_METACOGNITION_BEGIN \
    "[BEGIN DS4 OPTIONAL METACOGNITION POLICY]"
#define DS4_METACOGNITION_END \
    "[END DS4 OPTIONAL METACOGNITION POLICY]"

#define DS4_STRUCTURE_BEGIN \
    "[BEGIN DS4 STRUCTURE POLICY]"
#define DS4_STRUCTURE_END \
    "[END DS4 STRUCTURE POLICY]"

#define DS4_SAGE_BEGIN \
    "[BEGIN DS4 SAGE POLICY]"
#define DS4_SAGE_END \
    "[END DS4 SAGE POLICY]"

typedef struct {
    bool enabled;
    bool soul_loaded;
    bool ethic_loaded;
    bool structure_loaded;
    size_t soul_bytes;
    size_t ethic_bytes;
    size_t structure_bytes;
    char revision[41];
} ds4_default_skills_status;

#endif
